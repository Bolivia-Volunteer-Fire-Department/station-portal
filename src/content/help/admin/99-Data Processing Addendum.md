This Data Processing Addendum ("DPA") supplements the StationSync Terms of Service and Privacy Policy (the "Agreement") entered into by and between **StationSync** ("Processor" or "Service Provider") and the subscribing emergency services department, fire district, or municipal corporation identified in the signature block below ("Customer," "Agency," or "Controller").

---

### 1. Purpose and Scope

1. **Scope:** This DPA governs the processing of all Customer Personal Data and operational agency records provided to, or collected by, Processor in connection with Customer’s use of the StationSync workforce and station management platform.
2. **Roles of the Parties:**
   * Customer acts as the **Data Controller** (or business/agency), determining the purposes and means of processing member records, rosters, and operational logs.
   * StationSync acts as the **Data Processor** (or service provider), processing data solely on behalf of and under the documented instructions of Customer.

---

### 2. Processing Scope and Instructions

1. **Authorized Instructions:** Processor shall process Customer Personal Data solely to deliver, secure, and maintain the Service in accordance with the Agreement, this DPA, and Customer’s written instructions, unless otherwise required by applicable law.
2. **Prohibited Processing (No Sale/Monetization):** Processor shall not sell, rent, retain, use, or disclose Customer Personal Data for any commercial purpose other than providing the agreed-upon Service, nor merge Customer Personal Data with third-party advertising datasets.
3. **No Protected Health Information (PHI):** The parties expressly agree that StationSync is not an Electronic Patient Care Reporting (ePCR) repository. Customer agrees not to transmit, log, or store individually identifiable health records or PHI subject to HIPAA within the Service.

---

### 3. Data Protection and Security Controls

Processor shall maintain appropriate administrative, physical, and technical safeguards designed to ensure a level of security appropriate to the risks of processing emergency services workforce records. These controls include:

* **Logical Separation:** Enforcing tenant isolation via database access controls and security rules to prevent cross-agency data exposure.
* **Encryption Standards:** Encrypting all Customer Data in transit using modern TLS protocols (HTTPS) and encrypting database layers and storage buckets at rest.
* **Access Control:** Restricting administrative access to production systems strictly to authorized personnel with a verified operational need, protected by multi-factor authentication.
* **Geofencing Restraint:** Limiting geolocation capture strictly to momentary device verification during active timeclock actions, without continuous or background location tracking.

---

### 4. Sub-Processors

1. **Authorization:** Customer grants Processor general authorization to engage downstream infrastructure sub-processors necessary to operate the cloud environment.
2. **Approved Sub-Processors:** Processor currently utilizes:
   * **Google Cloud Platform / Firebase:** Cloud hosting, serverless computing, database storage (Firestore, Realtime Database), and notification routing (FCM).
   * **Apple Inc. (APNs):** Push alert delivery to iOS devices.
3. **Sub-Processor Obligations:** Processor shall ensure that each sub-processor is bound by contractual terms offering equivalent levels of data protection and confidentiality as outlined in this DPA.

---

### 5. Security Incidents and Breach Notification

1. **Notification:** In the event of a confirmed **Security Incident** (defined as unauthorized access to, or accidental or unlawful alteration, disclosure, or destruction of Customer Personal Data), Processor shall notify Customer without unreasonable delay, and in no event later than **seventy-two (72) hours** after becoming aware of the incident.
2. **Information Provided:** The notification shall include, to the extent known:
   * A description of the nature of the incident.
   * Categories of data and approximate number of records affected.
   * Remediation measures taken or planned to mitigate the incident.
3. **Cooperation:** Processor shall provide reasonable assistance to Customer in fulfilling any statutory breach notification obligations required under applicable state or federal law.

---

### 6. Public Records Requests, Audits, and Legal Compulsion

1. **Public Records / FOIA:** Customer acknowledges that it retains sole responsibility for responding to public records requests (e.g., FOIA, Sunshine laws) and legal discovery orders. If Processor receives a public records request directly regarding Customer’s data, Processor will promptly redirect the requesting party to Customer.
2. **Legal Orders:** If legally compelled by subpoena, warrant, or court order to disclose Customer Data, Processor will promptly notify Customer in writing prior to disclosure, unless prohibited by law.
3. **Audits:** Upon reasonable prior written notice, Processor shall make available documentation demonstrating compliance with the technical safeguards outlined in this DPA.

---

### 7. Data Return, Export, and Deletion

1. **Data Portability:** Customer may export rosters, logs, and administrative records at any time during the active subscription period through administrative export tools or upon written request.
2. **Decommissioning:** Within **thirty (30) days** following termination or expiration of the Agreement, Processor shall make available an export of Customer Data. Following this thirty-day window, Processor shall initiate secure deletion of Customer’s operational database instances from active production environments, subject to standard cloud backup retention cycles.

---

### 8. Order of Precedence

In the event of any conflict between the terms of this DPA and the Terms of Service, the provisions of this DPA shall govern with respect to the processing and security of Customer Personal Data.

---

### Schedule A: Details of Data Processing

* **Subject Matter:** Provision of workforce scheduling, attendance verification, apparatus tracking, internal messaging, and administrative compliance for emergency services personnel.
* **Duration:** The term of the underlying service agreement plus the post-termination data retention/export window.
* **Categories of Data Subjects:** Active firefighters, EMTs, officers, administrative staff, board members, and volunteer personnel.
* **Categories of Personal Data:** Names, agency contact information, radio/badge identifiers, rank/role, shift attendance records, timeclock timestamps, coordinates at time of punch, certifications, training logs, and internal communications.
* **Special Categories of Data:** None. Collection and transmission of patient medical records (PHI) is explicitly barred.

---

### Signatures

IN WITNESS WHEREOF, the authorized representatives of the parties have executed this Data Processing Addendum as of the date written below.

**For StationSync (Processor):**

Signature: ____________________________________

Name: _________________________________________

Title: __________________________________________

Date: __________________________________________

**For Customer / Department (Controller):**

Agency Name: _________________________________

Signature: ____________________________________

Name: _________________________________________

Title: (Fire Chief, Board President, or City Administrator)

Date: __________________________________________
