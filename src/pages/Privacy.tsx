// Public privacy policy — rendered before the auth gates in App.tsx so it is
// reachable without a session (Meta/WhatsApp Business verification, footer links).
// Source: standalone privacy.html. Shared styling lives in LegalLayout.

import LegalLayout from './LegalLayout';

export default function Privacy() {
  return (
    <LegalLayout>
      <header>
        <h1>Privacy Policy</h1>
        <div className="meta">Briklay Engineering &middot; Last updated 18 June 2026</div>
      </header>

      <p>This policy explains what information Briklay Engineering ("we", "us") collects when you interact with us, including through our WhatsApp business number and our website and applications, and how we use and protect it.</p>

      <h2>Who we are</h2>
      <p>Briklay Engineering is a construction and real estate business based in Hyderabad, Telangana, India. We operate a WhatsApp business number and related software to communicate with clients and manage our work.</p>

      <h2>Information we collect</h2>
      <ul>
        <li>Your WhatsApp phone number and profile name when you message us.</li>
        <li>The content of messages, photos, voice notes, and documents you send us.</li>
        <li>Information you provide directly, such as your name, project details, and contact information.</li>
        <li>Basic technical information when you use our website or apps, such as device and usage data.</li>
      </ul>

      <h2>How we use your information</h2>
      <ul>
        <li>To respond to your messages and provide the services you request.</li>
        <li>To record and manage project, payment, and procurement information you share with us.</li>
        <li>To send you updates, confirmations, and reminders related to our work together.</li>
        <li>To operate, maintain, and improve our services.</li>
        <li>To meet legal and accounting obligations.</li>
      </ul>

      <h2>WhatsApp messaging</h2>
      <p>We use the WhatsApp Business Platform, provided by Meta, to send and receive messages. Your messages are processed through WhatsApp's infrastructure and are subject to <a href="https://www.whatsapp.com/legal/privacy-policy" target="_blank" rel="noopener">WhatsApp's own Privacy Policy</a>. We only message people who have contacted us or agreed to hear from us. You can stop receiving messages at any time by replying <strong>STOP</strong>.</p>

      <h2>Sharing your information</h2>
      <p>We do not sell your personal information. We share it only with:</p>
      <ul>
        <li>Service providers who help us run our business, such as messaging platform (Meta/WhatsApp), cloud hosting, database, and processing providers, under appropriate confidentiality terms.</li>
        <li>Authorities or advisors where required by law or to protect our rights.</li>
      </ul>

      <h2>Data retention</h2>
      <p>We keep your information only for as long as needed to provide our services and to meet legal, tax, and accounting requirements, after which it is deleted or anonymised.</p>

      <h2>Your choices and rights</h2>
      <ul>
        <li>You can ask us what information we hold about you and request a copy.</li>
        <li>You can ask us to correct or delete your information.</li>
        <li>You can opt out of WhatsApp messages at any time by replying STOP.</li>
      </ul>
      <p>To make a request, contact us using the details below. You can also see our <a href="/data-deletion">data deletion instructions</a>.</p>

      <h2>Security</h2>
      <p>We take reasonable technical and organisational measures to protect your information against loss, misuse, and unauthorised access. No method of transmission or storage is completely secure, but we work to safeguard your data.</p>

      <h2>Children</h2>
      <p>Our services are intended for businesses and adults. They are not directed at children under 18, and we do not knowingly collect their information.</p>

      <h2>Changes to this policy</h2>
      <p>We may update this policy from time to time. The latest version will always be available at this page, with the date of the last update shown above.</p>

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
