TRU Troth Covenant Console: IFS Tracker
This repository hosts the TRU Troth Covenant Console, a centralized and collaborative tool for tracking the Integrity, Functionality, and Sustainability (IFS) scores of individuals within a cooperative covenant structure.
It is designed as a Single-File Static HTML Application, ensuring instant deployment with zero setup costs.
🚀 Deployment Status & Access
This application is deployed as a single-page static site. It requires no server-side build and connects directly to Google Firestore for real-time data synchronization.
| Host | Status | Link |
|---|---|---|
| Render | Recommended | [Paste your Render URL here after deployment] |
| Vercel/Netlify | Functional | [Paste your Vercel/Netlify URL here if you used it] |
💡 Core Functionality
The Covenant Console provides a real-time, shared environment for team members (Agents) to track and adjust their core scores.
Key Features:
 * Covenant Creation & Management: Create new covenants (teams) with unique IDs.
 * Shared, Real-Time Scoring: All Agents within a covenant see score updates instantly using Google Firestore.
 * Individual Score Cards: Agents track their own IFS scores:
   * Integrity: Honesty, Truthfulness, and Alignment to the Covenant.
   * Functionality: Execution, Competence, and Task Completion.
   * Sustainability: Long-Term Viability and Resilience.
 * Operational Log: A history log tracks score adjustments and membership changes.
 * Secure Authentication: Users are automatically signed in using anonymous or custom authentication tokens provided by the hosting platform.
🛠️ Technology Stack (Zero-Config)
This entire application is contained within a single index.html file, leveraging browser CDNs for instant loading.
 * UI/Design: React 18, Tailwind CSS (Custom Lime/Black Theme).
 * Data & Auth: Google Firestore, Firebase Authentication.
 * Deployment: Static Site (Ideal for Render or Vercel).
📝 Getting Started
1. Launch the Application
Access the Console via the live deployment URL (see the table above).
2. Initial Setup
 * The system automatically assigns you a unique Agent ID (visible in the top header). Share this ID with others to invite them to your Covenant.
 * Use the "CREATE NEW" button on the left sidebar to start your first Covenant.
3. Collaboration
 * To join another Covenant: Get the Covenant ID from the creator and ask them to paste your Agent ID into the "ADD AGENT" box in their console.
 * Score Updates: Only Agents (members) of a Covenant can update their own three core scores. Changes are instantly visible to all other Agents in that Covenant.
 * 
