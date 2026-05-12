# Hierarchia Manager Portal — User Guide

> **Client Delivery Document** | Version 1.0 | May 12, 2026  
> **Prepared by:** Shahroz Imran

---

## 1. Purpose of This Guide

This document is a complete end-user guide for the **Hierarchia Manager Portal**. It explains the purpose of the platform, who uses it, what each module does, and how to use every major part of the system in day-to-day work.

This guide is written for:

- Main Admins
- Managers
- Team Members
- Client-side stakeholders who need to understand how the delivered system is used

The portal is **role-aware**, so not every user will see every page. What you can access depends on:

- Your role
- Your assigned team or department
- Any access-control overrides granted by the Main Admin

---

## 2. System Overview

The **Hierarchia Manager Portal** is a web-based enterprise workflow platform designed to help organizations:

- Manage departments, teams, and users
- Assign tasks to staff members
- Receive and organize document submissions
- Validate submissions using AI-powered rule logic
- Enable internal communication through self-hosted messaging
- Share announcements and reference materials
- Review analytics, activity history, and AI usage
- Control access through role-based and capability-based permissions

At a high level, the portal combines **operations management**, **document intelligence**, **internal collaboration**, and **administrative governance** in one system.

---

## 3. User Roles and Access Model

The platform supports three main roles.

### 3.1 Main Admin

The **Main Admin** has organization-wide visibility and control.

Typical responsibilities include:

- Managing all departments and teams
- Provisioning users across the organization
- Managing role permissions and capability overrides
- Monitoring all submissions and team activity
- Reviewing reports and audit logs
- Managing AI usage controls and credit limits
- Posting global announcements
- Uploading globally visible materials

### 3.2 Manager

The **Manager** works primarily within their own team or department.

Typical responsibilities include:

- Assigning tasks to team members
- Monitoring team submissions
- Reviewing AI validation outcomes
- Managing team-specific materials and announcements
- Viewing team analytics and activity logs
- Managing team members within their scope
- Maintaining validation rules if permitted

### 3.3 Member

The **Member** is usually the end user performing assigned operational work.

Typical responsibilities include:

- Viewing assigned tasks
- Uploading task-based submissions
- Tracking submission status and AI outcomes
- Using messaging and announcements
- Accessing materials shared with their team
- Viewing department information
- Updating their own profile and password
- Using Smart AI if access has been granted

### 3.4 Important Access Note

The system uses both **role-based defaults** and **capability-based permissions**.

This means:

- A role gives a normal starting access pattern
- A Main Admin can further allow or deny specific abilities for a user
- Some users may see more or fewer modules than others, even within the same role

---

## 4. Getting Started

### 4.1 Sign In

Users access the platform using their provided account credentials.

After sign-in, the system loads the dashboard according to the user’s role and allowed modules.

### 4.2 First Login and Password Reset

On first login, some users may be required to reset their password before accessing the rest of the dashboard.

This ensures:

- Secure account activation
- Removal of temporary credentials
- User-controlled password setup

### 4.3 Main Layout

The dashboard layout is built around three primary areas:

- **Sidebar navigation** for modules and pages
- **Top bar** for user context and quick actions
- **Main content area** for lists, forms, analytics, and workflow actions

### 4.4 Navigation Groups

The sidebar is typically organized into these groups:

- **Workspace**
  - Overview
  - Tasks
  - Submissions
  - Messages
  - Announcements
  - Materials

- **Intelligence**
  - Smart AI
  - Reports
  - Activity Log

- **Administration**
  - Validation Rules
  - Team Members
  - My Department
  - Departments
  - Access Control
  - AI & Usage
  - Settings

### 4.5 Mobile Usage

On smaller screens, navigation adapts to a mobile-friendly format. The available modules remain role-based, but the layout changes to support smaller devices.

---

## 5. Module-by-Module User Guide

## 5.1 Overview Dashboard

The **Overview** page is the home page after login.

Its purpose is to give the user a quick operational snapshot.

Depending on role, it may show:

- Summary statistic cards
- Recent submissions
- Open tasks
- Materials
- Announcements
- Activity log
- Role indicator showing whether the user is Main Admin, Manager, or Member

### How users typically use it

- **Main Admins** use it to get a high-level view across all teams
- **Managers** use it to monitor their team’s work and submission trends
- **Members** use it to quickly check current tasks, recent updates, and available materials

---

## 5.2 Tasks

The **Tasks** module is one of the main workflow centers of the platform.

### What the Tasks module is used for

- Creating work assignments
- Setting deadlines
- Defining late-submission rules
- Assigning work to all or selected team members
- Tracking assignment status
- Linking tasks to AI evaluation logic

### Manager and Main Admin usage

Users with task-management capability can:

- Create a new task
- Select the target team
- Add a task title and description
- Add AI evaluation instructions or brief
- Set a required deadline
- Allow or disallow late submissions
- Set a late-submission deadline when late submission is allowed
- Require a late reason where needed
- Assign the task to all team members or selected users
- Attach validation-rule selection logic where available

### Member usage

Members typically see their own tasks only.

The task area separates work into:

- **Open** tasks
- **History** tasks

A member can:

- Open a task
- Review title, description, and deadline
- See whether late submission is allowed
- Upload the required file
- Provide a late reason if the system requires it
- Return later to view the linked submission and result

### Task detail page

The task detail page may show:

- Task title and description
- Deadline information
- Submission counts
- Late and missed counts
- AI evaluation brief/instructions
- Assignment table for managers
- Per-member submission status
- Score and summary previews for submitted work

### Important behavior

Submissions in this platform are **task-driven**. Users do not create general uploads from a separate ad-hoc submission screen. They submit files as part of a task workflow.

---

## 5.3 Submissions

The **Submissions** module is the main place to track uploaded work and AI validation outcomes.

### What the Submissions module is used for

- Reviewing uploaded files
- Monitoring validation status
- Opening submission details
- Exporting records where allowed
- Tracking who uploaded what and when

### Role-based usage

- **Members** generally see their own uploads and their validation progress
- **Managers** and **Main Admins** can view broader team or organization-level submission lists
- Authorized users can export submission data

### Submission list page

The submissions page supports monitoring at scale and is intended to be:

- Sortable
- Filterable
- Review-friendly
- Exportable for higher-access roles

Members may also see a shortcut back to open tasks if they need to submit more work.

### Submission detail page

Opening a submission shows a detailed record that can include:

- File title
- Uploader name
- File size and upload time
- Submission status badge
- Score out of 100 where available
- AI summary
- Validation flags
- Rule-by-rule results
- File metadata
- Extracted text
- Linked task reference
- Late submission note if applicable
- Original file access via secure download/open action

### Validation details users can review

The validation detail view may display:

- Whether the submission passed or failed
- Whether the submission needs manual review
- Which rules were checked
- Reasons generated for each rule
- Score by rule where available
- Warnings, failures, or informational flags

### Retry and delete actions

Depending on access level and context, some users may be able to:

- Retry processing where a system-side issue occurred
- Delete a submission if they have the required permissions

---

## 5.4 AI Validation Pipeline and Rule Logic

The platform includes an AI-based validation layer for submitted files.

### What happens after a file is uploaded

A typical submission lifecycle may include these stages:

- Queued
- Parsing
- Validating
- Passed
- Failed
- Needs review

In some task contexts, users may also see assignment-related states such as:

- Assigned
- Pending
- Submitted
- Late submitted
- Missed

### What the AI checks can involve

The system may perform:

- File parsing across supported formats
- OCR fallback for scanned or image-heavy content
- Validation against configured rules
- Weighted scoring
- AI-generated summary generation
- Review recommendation when the system is uncertain

### Why this matters to the user

The AI layer helps users and reviewers:

- Reduce manual review time
- Identify missing or weak content quickly
- Standardize evaluation against rules
- Highlight risky or incomplete submissions

---

## 5.5 Messages

The **Messages** module is the platform’s self-hosted internal communication system.

### What the Messages module is used for

- Direct messages between users
- Group conversations
- Real-time communication inside the platform
- Sharing attachments or media where supported
- Collaborating without relying on external chat tools

### Conversation sidebar features

The conversation sidebar supports:

- Conversation list
- Search bar for finding conversations
- Filters such as:
  - All
  - Unread
  - Groups
- Unread counts
- New direct message creation
- New group creation

### Conversation view features

Inside a conversation, users can typically:

- Read live messages
- Send new text messages
- Share supported attachments
- Reply to a specific message
- React to messages
- View typing indicators
- See conversation updates in real time
- Open direct-message or group information panels

### Group collaboration usage

In group conversations, users may also work with:

- Group identity or metadata
- Member lists
- Group updates where permitted
- Shared team communication history

### Messaging best use cases

- Clarifying assigned work
- Discussing submission feedback
- Coordinating within a team
- Sending internal operational updates

---

## 5.6 Announcements

The **Announcements** module is used for structured notices and operational communication.

### What Announcements are used for

- Team updates
- Deadline reminders
- Operational notices
- Priority communications
- Time-sensitive instructions

### Announcement features

Authorized users can create announcements with:

- Title
- Body/content
- Priority level
- Team or global target
- Optional expiry date

### Role behavior

- **Main Admin** can create global announcements
- Team-scoped announcement creation depends on permissions and team context
- Users with read access can view relevant announcements
- Authorized users can delete announcements

### Typical announcement examples

- New submission deadline
- Department notice
- Team meeting reminder
- Updated compliance process
- System usage guidance

---

## 5.7 Materials

The **Materials** module provides a central place for reference documents and shared files.

### What Materials are used for

- Templates
- Guidelines
- Team resources
- Shared documentation
- Reference files for completing tasks correctly

### Material features

Users with access can:

- View available materials
- Open shared documents
- Use them as reference while completing work

Authorized users may also be able to:

- Upload new materials
- Delete materials
- Export materials lists
- Publish materials globally or to a specific team, depending on role

### Common uses

- Sharing task templates
- Publishing standard document formats
- Providing policy documents
- Keeping supporting files in one place

---

## 5.8 Smart AI

The **Smart AI** module is the portal’s conversational intelligence layer.

It combines AI assistance, retrieval-based document access, and usage-aware controls.

### Main Smart AI sections

The Smart AI area includes three main tabs:

- **Assistant**
- **Submissions Review**
- **Insights & Logs**

### Assistant tab

The **Assistant** tab allows users to ask questions about portal data and workflows.

Typical use cases include:

- Asking about submissions
- Reviewing validation trends
- Understanding rule behavior
- Asking about tasks and team performance
- Getting contextual help from indexed content

### Submissions Review tab

The **Submissions Review** tab is designed to help users browse recent submissions and ask for AI help quickly.

Typical usage includes:

- Selecting a submission
- Triggering a one-click AI summary prompt
- Reviewing flags, score, and follow-up suggestions

### Insights & Logs tab

The **Insights & Logs** tab focuses on AI-related operational visibility, such as:

- Retrieval analytics
- Query volume
- Latency signals
- Recent AI question activity

### Smart AI usage notes

- Access depends on permissions
- AI usage may be governed by credits or limits
- The interface can reopen specific conversations using thread-linked URLs
- Responses are intended to help with analysis, not replace human responsibility

---

## 5.9 Reports

The **Reports** module provides analytics for managers and main administrators.

### What Reports are used for

- Monitoring submission activity over time
- Reviewing day-, week-, and month-level trends
- Understanding validation performance
- Tracking operational movement across the system

### Typical report use cases

- Measuring team performance
- Monitoring submission volume
- Reviewing pass/fail patterns
- Spotting productivity or quality trends

---

## 5.10 Activity Log

The **Activity Log** is an audit-style view of actions taken in the workspace.

### What the Activity Log shows

It may record actions such as:

- User operations
- Task creation events
- Announcement actions
- Submission-related activity
- Administrative actions
- Other tracked system events

### Why it is useful

The activity log supports:

- Traceability
- Operational accountability
- Review of team actions
- Investigation of process history

---

## 5.11 Validation Rules

The **Validation Rules** page is used to define how the AI evaluates submissions.

### What rules are used for

Rules help the system decide:

- What should be checked in a submission
- What conditions count as success or failure
- How scoring should be weighted
- What the AI should explain in its output

### Who uses this page

This page is normally for:

- Main Admins
- Managers
- Any user who has been explicitly granted validation-rule access

### Typical rule-management actions

Authorized users may be able to:

- View rules
- Create rules
- Update rules
- Delete rules
- Assign rules in a team-aware context

### Practical impact

Changing a rule changes how future submissions are evaluated, so this page should be used carefully by authorized personnel only.

---

## 5.12 Team Members

The **Team Members** page is used to manage people in the system.

### Manager usage

Managers typically use this page to:

- View members on their own team
- Review team member information
- Manage team-scoped people operations within their allowed authority

### Main Admin usage

Main Admins typically use this page to:

- View all user accounts across the organization
- Provision new users
- Review user placement across teams
- Manage member records at a broader scope

### Provisioning usage

Where enabled, Main Admins can use the provisioning area to:

- Create new user accounts
- Assign users to teams
- Establish organizational placement for new users

---

## 5.13 My Department

The **My Department** page gives Managers and Members a simple department view.

### What users can see

- Department information
- Team manager details
- Fellow team members
- Their own placement inside the department

### If no department is assigned

The system displays a notice telling the user they are not assigned to a department and should contact an administrator.

---

## 5.14 Departments

The **Departments** page is mainly for Main Admin usage.

### What this page is used for

- Managing organizational structures
- Creating and maintaining departments
- Assigning managers
- Grouping users correctly
- Reviewing department statistics or overview lists

This page supports the structural foundation of the whole portal.

---

## 5.15 Access Control

The **Access Control** page is used to manage per-user permission overrides.

### What this module is used for

- Granting additional capabilities
- Revoking certain capabilities
- Adjusting access beyond basic role defaults
- Controlling exactly which modules a user can use

### Important concept

The platform applies:

- Role defaults first
- Then user-specific overrides where set

This means a Main Admin can fine-tune user access without changing the user’s base role.

### Typical use cases

- Give a manager access to a specific admin function
- Remove access to a module for a particular user
- Allow a user to read validation rules without full admin status

---

## 5.16 AI & Usage

The **AI & Usage** page is a Main Admin monitoring and governance page.

### What it is used for

- Reviewing AI credit limits
- Monitoring platform-wide AI usage trends
- Viewing AI transaction or activity ledgers
- Tracking overall AI message volume

### Why it matters

This page helps ensure that AI usage remains:

- Controlled
- Auditable
- Cost-aware
- Operationally manageable

---

## 5.17 Settings

The **Settings** page is the personal account-management area for all users.

### What users can do in Settings

- View profile identity details
- Update profile information
- Change password
- Complete required password reset on first login when applicable

This is the main self-service account page inside the portal.

---

## 6. Common End-to-End Workflows

## 6.1 Main Admin Workflow

A typical Main Admin workflow may look like this:

1. Sign in and open the Overview dashboard
2. Review organization-wide summaries
3. Create or update departments
4. Provision users and assign them to teams
5. Adjust access-control permissions if needed
6. Review AI usage and audit activity
7. Publish announcements or global materials
8. Monitor reports and platform operations

## 6.2 Manager Workflow

A typical Manager workflow may look like this:

1. Sign in and review Overview
2. Open Team Members or My Department for team context
3. Create a new task
4. Add instructions, deadline, and late policy
5. Assign task to team members
6. Wait for submissions to arrive
7. Review validation outcomes in Submissions
8. Use Smart AI for additional insight
9. Post team announcements or upload materials where appropriate
10. Monitor Reports and Activity Log

## 6.3 Member Workflow

A typical Member workflow may look like this:

1. Sign in and review open tasks
2. Open a task and read the instructions carefully
3. Prepare the required document
4. Upload the file from the task detail page
5. Provide a late reason if required
6. Track the result in Submissions
7. Review AI summary, score, and flags
8. Use Messages for team communication
9. Check Announcements and Materials regularly
10. Update profile or password in Settings when needed

## 6.4 Submission Review Workflow

A typical submission review process may be:

1. Open the Submissions page
2. Select a submission record
3. Review its current status
4. Read the AI summary
5. Inspect validation rule results
6. Check score and flags
7. Open the linked task if more context is needed
8. Take the next business action based on the result

## 6.5 Smart AI Workflow

A typical Smart AI workflow may be:

1. Open Smart AI
2. Start in the Assistant tab
3. Ask a question about submissions, tasks, or team performance
4. Review the response
5. Switch to Submissions Review for targeted analysis
6. Use Insights & Logs for AI operational visibility

## 6.6 Messaging Workflow

A typical messaging workflow may be:

1. Open Messages
2. Search for a person or pick an existing conversation
3. Start a new direct message or create a group
4. Send text or supported attachments
5. Reply to specific messages where needed
6. Watch for typing indicators and unread counts
7. Continue live collaboration in real time

---

## 7. Important Statuses and Terms Users May See

### Task and assignment-related states

Users may encounter states such as:

- Assigned
- Pending
- Submitted
- Late submitted
- Missed

### Submission processing states

Users may encounter states such as:

- Queued
- Parsing
- Validating
- Passed
- Failed
- Needs review

### What “Needs review” usually means

This status generally means the system could not safely produce a fully confident pass/fail conclusion and a human should review the item.

---

## 8. Best Practices for Users

- **[Read instructions carefully]** Always review the full task brief before uploading a file.
- **[Watch deadlines]** Check whether late submissions are allowed and whether a late deadline exists.
- **[Use materials]** Open shared templates and guides before preparing work.
- **[Review AI output carefully]** Treat AI summaries and flags as strong guidance, but still confirm important details.
- **[Use messages for collaboration]** Keep communication inside the platform where possible.
- **[Check announcements regularly]** Important operational updates may be posted there.
- **[Keep your account secure]** Update your password and never share credentials.
- **[Request proper access]** If a module is missing, contact the administrator instead of assuming it is unavailable permanently.

---

## 9. Troubleshooting Guidance

### If you cannot see a module

Possible reasons include:

- Your role does not include that page
- Your account does not have the required capability
- Your administrator has not assigned the needed access

### If you cannot submit a file

Check the following:

- The task is still open
- The deadline has not passed, or late submission is allowed
- Your file type is acceptable
- Your file size is within system limits

### If a submission is stuck in processing

The item may still be:

- Queued
- Parsing
- Validating

If it does not update after a reasonable period, contact an administrator.

### If you are missing a department or team

Contact the Main Admin or relevant manager so your account can be assigned correctly.

### If you cannot use Smart AI

Possible reasons include:

- Your role or permissions do not allow it
- AI usage has been restricted for your account
- Your usage quota or credit limit may have been reached

---

## 10. Administrative Governance Notes

For client and admin understanding, the platform includes governance layers that affect user experience:

- Role-based access control
- Per-user capability overrides
- Team-aware visibility
- Audit logging
- AI usage tracking and limits
- Controlled access to sensitive records

These governance features are intentional and help keep the system secure, traceable, and operationally manageable.

---

## 11. Final Notes

This user guide is intended to help users understand the full delivered workflow of the **Hierarchia Manager Portal**.

Because the portal is highly role-aware, the exact experience may differ slightly between:

- Main Admins
- Managers
- Members
- Users with custom permission overrides

If additional documentation is required, this guide can also be expanded into:

- Role-specific quick-start guides
- Administrator-only operating instructions
- Manager workflow handbooks
- Team member onboarding documentation
- PDF client submission material
