// site_tasks insert that survives a drifted task_no sequence.
//
// task_no is normally a DB default (generate_task_no → ST-YYYY-NNNN); no code path sets it. A duplicate
// on site_tasks_task_no_key means the global sequence `site_task_seq` has fallen BEHIND the numbers
// already in the table (a restore, an import, a manual reset), so the default hands out a number a row
// already owns. Project creation inserts a whole skeleton in ONE statement, so a behind sequence fails
// the entire batch.
//
// The permanent fix is the self-healing generate_task_no in the DB (migration 20260826000000). This is
// the CLIENT belt-and-suspenders so the app works even before that SQL is applied: on the specific
// collision, we stop trusting the sequence and STAMP task_no ourselves from the live max — global, so
// unique across years — then re-insert. A failed INSERT wrote nothing, so replaying is safe.

const isTaskNoDup = (e: unknown): boolean => {
  const m = (e as { message?: string })?.message;
  return typeof m === 'string' && (m.includes('site_tasks_task_no') || (m.includes('duplicate key') && m.includes('task_no')));
};

const pad4 = (n: number): string => String(n).padStart(4, '0');

/** Highest task NUMBER currently in the table (across all years — the sequence is global). Read only
 *  on the rare fallback path. */
async function currentMaxTaskNumber(supabase: any): Promise<number> {
  const { data } = await supabase.from('site_tasks').select('task_no');
  let max = 0;
  for (const r of (data ?? []) as Array<{ task_no?: string | null }>) {
    const m = /^ST-\d{4}-(\d+)$/.exec(r.task_no ?? '');
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  return max;
}

/** Run a supabase site_tasks insert, retrying ONLY on a task_no unique-collision. Used for the single
 *  desk add (one row); batch paths use insertSiteTasks below. */
export async function withTaskNoRetry<T extends { error: unknown }>(run: () => PromiseLike<T>, attempts = 8): Promise<T> {
  let res = await run();
  let n = 0;
  while (res.error && isTaskNoDup(res.error) && n < attempts) { n++; res = await run(); }
  return res;
}

/**
 * Insert a batch of site_tasks. Happy path: the DB default mints task_no. If that collides (drifted
 * sequence), fall back to stamping task_no explicitly from the live max — bypassing the sequence
 * entirely — and re-insert. Retries a few times so a rare concurrent stamp settles. Returns {error}.
 */
export async function insertSiteTasks(supabase: any, rows: any[]): Promise<{ error: unknown }> {
  let res = await supabase.from('site_tasks').insert(rows);
  if (!res.error || !isTaskNoDup(res.error)) return { error: res.error };

  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 6; attempt++) {
    const base = await currentMaxTaskNumber(supabase);
    const stamped = rows.map((r, i) => ({ ...r, task_no: `ST-${year}-${pad4(base + 1 + i)}` }));
    res = await supabase.from('site_tasks').insert(stamped);
    if (!res.error || !isTaskNoDup(res.error)) return { error: res.error };
  }
  return { error: res.error };
}
