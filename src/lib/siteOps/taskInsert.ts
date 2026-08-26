// site_tasks insert with a task_no-collision retry.
//
// task_no is ALWAYS a DB default (generate_task_no → ST-YYYY-NNNN); no code path sets it. A duplicate
// on site_tasks_task_no_key means the global sequence `site_task_seq` has drifted BEHIND the numbers
// already in the table (a restore, an import, a manual reset), so the default hands out a number a row
// already owns. The permanent fix is the self-healing generate_task_no in the DB; this bounded retry is
// the client-side belt-and-suspenders: a failed INSERT wrote nothing (statement is atomic), and each
// replay re-evaluates the default with a fresh number, so retrying walks past the drift — and it also
// rescues a rare concurrent collision. Only retries THIS specific error; anything else returns at once.

const isTaskNoDup = (e: unknown): boolean => {
  const m = (e as { message?: string })?.message;
  return typeof m === 'string' && (m.includes('site_tasks_task_no') || (m.includes('duplicate key') && m.includes('task_no')));
};

/** Run a supabase site_tasks insert, retrying only on a task_no unique-collision. */
export async function withTaskNoRetry<T extends { error: unknown }>(run: () => PromiseLike<T>, attempts = 8): Promise<T> {
  let res = await run();
  let n = 0;
  while (res.error && isTaskNoDup(res.error) && n < attempts) { n++; res = await run(); }
  return res;
}
