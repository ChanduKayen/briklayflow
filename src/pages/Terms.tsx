// Public terms of service — rendered before the auth gates in App.tsx so it is
// reachable without a session (Meta/WhatsApp Business verification, footer links).
// Source: standalone terms.html. Shared styling lives in LegalLayout.

import LegalLayout from './LegalLayout';

export default function Terms() {
  return (
    <LegalLayout>
      <header>
        <h1>Terms of Service</h1>
        <div className="meta">Briklay Engineering &middot; Last updated 18 June 2026</div>
      </header>

      <p>These terms govern your use of Briklay Engineering's WhatsApp business number, website, and applications ("our services"). By messaging us or using our services, you agree to these terms.</p>

      <h2>Who we are</h2>
      <p>Briklay Engineering is a construction and real estate business based in Hyderabad, Telangana, India.</p>

      <h2>Our services</h2>
      <p>We use WhatsApp and related software to communicate with clients, share project information, provide quotes and estimates, and coordinate payments and procurement. Quotes and estimates shared through messaging are indicative and do not form a binding contract. Actual project work is governed by a separate signed agreement.</p>

      <h2>Messaging</h2>
      <p>We send and receive messages through the WhatsApp Business Platform, provided by Meta, and your use is also subject to WhatsApp's own terms. We only message people who have contacted us or agreed to hear from us. You can stop receiving messages at any time by replying <strong>STOP</strong>.</p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Provide accurate and current information when you contact us.</li>
        <li>Use our services lawfully and only for legitimate business purposes.</li>
        <li>Do not send unlawful, abusive, misleading, or infringing content.</li>
      </ul>

      <h2>Quotes, estimates, and payments</h2>
      <p>Any pricing, estimate, or timeline shared through messaging is indicative and subject to change until confirmed in a signed agreement. Payments are due according to the terms set out in that agreement.</p>

      <h2>Intellectual property</h2>
      <p>Our brand, content, designs, and software are owned by Briklay Engineering and may not be copied or reused without permission.</p>

      <h2>Disclaimers</h2>
      <p>Our services are provided on an "as is" and "as available" basis. We do not guarantee that messaging will always be available or uninterrupted.</p>

      <h2>Limitation of liability</h2>
      <p>To the maximum extent permitted by law, Briklay Engineering is not liable for any indirect, incidental, or consequential loss arising from your use of our services.</p>

      <h2>Changes to these terms</h2>
      <p>We may update these terms from time to time. The latest version will always be available at this page, with the date of the last update shown above.</p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of India. Any disputes are subject to the exclusive jurisdiction of the courts of Hyderabad, Telangana.</p>

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
