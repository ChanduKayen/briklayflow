// Public user-data-deletion instructions — rendered before the auth gates in
// App.tsx so it is reachable without a session (Meta/WhatsApp Business requires a
// data-deletion URL). Source: standalone data-deletion.html. Shared styling lives
// in LegalLayout.

import LegalLayout from './LegalLayout';

export default function DataDeletion() {
  return (
    <LegalLayout>
      <header>
        <h1>User Data Deletion</h1>
        <div className="meta">Briklay Engineering &middot; Last updated 18 June 2026</div>
      </header>

      <p>You can ask us to delete the personal information we hold about you at any time. This page explains how to make that request and what happens next.</p>

      <h2>How to request deletion</h2>
      <p>Choose either option:</p>
      <ul>
        <li><strong>On WhatsApp:</strong> message our WhatsApp business number and reply <strong>DELETE</strong>, or ask us to delete your data.</li>
        <li><strong>By email:</strong> write to <a href="mailto:kchandubabunaidu@gmail.com">kchandubabunaidu@gmail.com</a> with the subject "Data Deletion Request" and include the phone number you used to contact us, so we can locate your records.</li>
      </ul>

      <h2>What we delete</h2>
      <p>On a valid request we delete the personal information associated with you, including your contact details and the messages, photos, and documents you sent us, from our active systems.</p>

      <h2>What we may keep</h2>
      <p>We may retain limited information where we are legally required to, for example records needed for tax, accounting, or legal compliance. Messages already delivered through WhatsApp are also governed by WhatsApp's own policies and are outside our control.</p>

      <h2>How long it takes</h2>
      <p>We process valid deletion requests within 30 days and confirm once it is done.</p>

      <h2>Contact us</h2>
      <p>
        Briklay Engineering<br />
        HITEC City, Hyderabad<br />
        Telangana, India<br />
        Email: <a href="mailto:kchandubabunaidu@gmail.com">kchandubabunaidu@gmail.com</a>
      </p>

      <footer>
        &copy; 2026 Briklay Engineering. All rights reserved.
      </footer>
    </LegalLayout>
  );
}
