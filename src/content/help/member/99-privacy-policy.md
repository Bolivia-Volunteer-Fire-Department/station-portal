Last updated: October 2026

StationSync ("we," "our," or "us") provides workforce management, operational logging, scheduling, and communication software to emergency services agencies, including fire departments, rescue squads, and emergency medical services organizations (each, an "Agency" or "Department").

This Privacy Policy describes how we collect, process, secure, and disclose information through the StationSync web application, mobile applications, and associated services (collectively, the "Service").

---

### 1. Roles and Data Governance: Controller vs. Processor

StationSync operates as a **Data Processor** (or service provider) on behalf of our customer Agencies. The subscribing Agency is the **Data Controller** responsible for managing member accounts, determining record retention rules, and ensuring compliance with applicable employment and public safety regulations.

If you are an active member, employee, or volunteer using StationSync, your access is provisioned by your Agency. Inquiries regarding account creation, record alteration, or data deletion should be directed to your Department administrator.

---

### 2. Information We Collect

To deliver scheduling, attendance, and operational features, we collect and process the following categories of information:

* **Account & Profile Information:** Full name, email address, phone number, emergency contact details, department rank/title, badge/radio ID numbers, and assigned station/shift assignments.
* **Operational & Administrative Records:** Shift schedules, availability, timeclock punches, training completions, certifications and expiration dates, apparatus inspection checklists, equipment maintenance logs, and station announcements.
* **Precise Geolocation Data (Active Clock-In Only):** When clocking in or out via the Service, geographic coordinates are briefly captured to verify physical station presence in accordance with your Department's geofencing rules. **StationSync does not track, log, or access continuous background location.** Location data is evaluated strictly during active timeclock submissions.
* **Internal Communications:** Text messages, status updates, and announcements transmitted through StationSync station chat channels and direct officer dispatches.
* **Device, Log, and Diagnostic Data:** IP addresses, browser platform identifiers, operating system versions, access timestamps, and push notification tokens (e.g., Firebase Cloud Messaging) necessary to authenticate sessions and route time-sensitive alerts.

> [!IMPORTANT]
> **No Protected Health Information (PHI):** StationSync is an administrative workforce platform, not an Electronic Patient Care Reporting (ePCR) or medical dispatch system. Users and Agencies are strictly prohibited from uploading, transmitting, or storing patient health records, diagnostic narratives, or identifiable medical data within the Service.

---

### 3. How We Use Information

Information processed by StationSync is used exclusively to:

* Provide, maintain, and secure the Service across Agency subdomains.
* Calculate timeclock totals, manage shift trades, track certifications, and render duty rosters.
* Transmit push notifications and alerts regarding shift coverage, recalls, training, and station announcements.
* Facilitate administrative compliance audits, credential verification, and internal reporting for Department leadership.
* Detect, investigate, and prevent unauthorized account access, security vulnerabilities, or operational disruptions.

We do **not** sell, rent, or monetize personal information, operational logs, or communication data, nor do we use Department records for third-party advertising or behavioral tracking.

---

### 4. Third-Party Sub-Processors and Data Infrastructure

We rely on trusted enterprise cloud infrastructure to host and execute the Service. Current primary sub-processors include:

* **Google Cloud Platform / Firebase:** Managed cloud infrastructure, database hosting (Cloud Firestore, Realtime Database), cloud storage, user authentication, and Firebase Cloud Messaging (FCM).
* **Apple Push Notification Service (APNs):** Delivery of operational alerts and push notifications to iOS devices.
* **Mapping and GIS Service Providers:** Rendering static or interactive geospatial layers (such as station perimeters or flood zone maps).

All sub-processors are bound by strict data processing agreements requiring industry-standard security and confidentiality controls.

---

### 5. Legal Disclosures, Public Records, and FOIA

Because our customer Agencies are public sector or non-profit emergency service providers, data stored in StationSync may constitute official agency records.

* **Public Records Requests:** Your Department is solely responsible for responding to Freedom of Information Act (FOIA), state open records (e.g., Sunshine laws), or civil discovery requests.
* **Legal Compulsion:** StationSync will not disclose Agency data to third parties or law enforcement except when strictly compelled by valid legal process (e.g., court order, warrant, or subpoena) or to protect life and safety in verified emergency situations. Where legally permitted, we will provide prompt notice to the affected Department administrator.

---

### 6. Data Security Safeguards

We implement administrative, technical, and physical safeguards designed to protect operational records:

* **Encryption:** All data in transit is encrypted using modern TLS (HTTPS). Data stored within our database and storage layers is encrypted at rest.
* **Access Isolation:** Multi-tenant architecture and granular database security rules ensure each Department's operational data is logically and administratively partitioned from other agencies.
* **Credential Protection:** Passwords are encrypted and managed using salted cryptographic hashing via enterprise authentication standards.

---

### 7. Data Retention and Deprovisioning

* **Active Accounts:** Department records (including shift histories, certifications, and logs) are retained for the duration of the Agency's active subscription, subject to the administrative discretion and legal retention schedules of the Department.
* **Terminated Accounts:** Upon termination of an Agency’s contract, StationSync provides a thirty (30) day export window for authorized administrators to retrieve operational data. Following this period, Agency operational databases and associated records are scheduled for secure deletion from active production environments.

---

### 8. User Rights and Inquiries

Individual users seeking to review, update, or correct their personal profile data may do so directly through the User Profile interface within the application.

For requests involving the modification or deletion of official operational logs, training records, or timeclock histories, please contact your Department’s designated StationSync system administrator.

---

### 9. Changes to This Privacy Policy

We may update this Privacy Policy periodically to reflect enhancements to the Service or changes in applicable legal standards. When material changes are made, we will update the "Last updated" date above and provide notice via the administrative portal or station announcement feed.

---

### 10. Contact

If you have questions about this Privacy Policy or how your information is handled, please consult your department's system administrator or contact StationSync support.
