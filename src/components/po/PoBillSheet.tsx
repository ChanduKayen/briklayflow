// PO record-bill door — the same door as the Bills page, with the two things this PO already knows
// filled in and locked: the vendor and the site. "Record bill" still opens the picker directly, so
// the sheet arrives with the file in hand and starts reading it immediately.
//
// It used to mint the moment the reading finished — no chance to correct a misread number or amount,
// and a duplicate was silently "linked" without ever saying so. The pipeline underneath is unchanged
// (intakeCommit, source 'po', the org-wide dedupe inside); what changed is that you see what it read.
import NewBillModal from '../bills/NewBillModal';
import { intakeCommit } from '../../lib/billIntake';

export function PoBillSheet({ poId, orgId, stakeholderId, projectId, vendorName, initialFile, onClose, onDone }: {
  poId: string; orgId: string; stakeholderId: string | null; projectId: string | null; vendorName: string;
  initialFile?: File | null; onClose: () => void; onDone: () => void;
}) {
  if (!stakeholderId) return null;   // a PO with no vendor has nothing to bill against
  return (
    <NewBillModal
      open
      title="Record the bill"
      onClose={onClose}
      initialFile={initialFile ?? null}
      lockVendor={{ id: stakeholderId, name: vendorName }}
      lockProject={projectId ? { id: projectId } : null}
      commit={async (d) => {
        // Capped, so a stuck writer surfaces an error instead of an endless "Filing…".
        const res = await Promise.race([
          intakeCommit(
            { orgId, source: 'po', file: d.file, vendorId: stakeholderId, poId, projectId },
            { vendor: d.vendorName || vendorName, billNo: d.billNo, billDate: d.billDate, amount: d.amount, lines: d.lines },
            stakeholderId, { allowDuplicate: d.allowDuplicate },
          ),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Saving the bill took too long. Try again.')), 30_000)),
        ]);
        if (res.status === 'duplicate') return { duplicate: res.existing };
        onDone();
      }}
    />
  );
}
