# Gym Tracker — UI/UX design brief for Gemini

## What to design

Design a lightweight, phone-first app that also works on a laptop. It is an installable web app for one user in the first release. The app helps the user plan activities, record what they actually did, and review past dates. Produce a coherent mobile design system and the key screens listed below. Adapt the layouts for desktop without changing the workflow.

Keep the interface simple enough to use during a workout. Prioritize fast scanning, clear targets versus actuals, large touch targets, and an obvious offline/sync state. Avoid dashboards or analytics concepts in this design pass.

## Core concepts

- **Activity:** A concrete action with a defined metric and target. Examples: bench press with three target sets of 12, 10, and 8 reps; walk 5 km; walk 30 minutes; take supplements (Yes/No). “Walking” without a target or metric is not a complete activity.
- **Category:** An editable name-and-emoji field on an activity, such as 💪 Strength, 🏃 Cardio, 🧘 Mobility, or 🏋️ Other. Those are starter choices, not fixed categories. The app maintains a category legend for choosing and editing them.
- **Mission:** An optional grouping for activities. Missions do not schedule activities. Activities are scheduled individually. An activity may have no Mission.
- **Schedule:** Either one selected date or selected weekdays with one shared start time. A repeating schedule may have an end date. The start time is selected when scheduling the activity.
- **Dated activity:** The activity planned or recorded on a particular date. A dated record preserves its plan and results even if a reusable activity is later edited.
- **Challenge:** A future feature. A challenge may refer to an existing activity, even one already associated with a Mission. The activity is logged once per date, and that one result can count toward both. Do not design challenge or analytics screens yet.

## Tracking methods

Each activity uses exactly one method:

1. **Yes/No:** The user taps Yes or No directly in the compact Home row. There is no Done button.
2. **Amount out of target:** The target and actual use a unit such as reps or km. Reps can have multiple sets, each with its own target. At least one target segment is required, and every planned target must be filled when the activity is created. In the expanded card, the user enters actual values and presses one **Done** button for the whole activity. Pressing Done again saves updated totals for any segment. For example, changing Set 1 from 8 to 10 records 10 total reps, not an additional 10.
3. **Duration:** Target and actual are both in `hh:mm`. The user enters the actual duration and presses **Done** in the expanded card.

For amount and duration, Done saves what was entered; target achievement can be shown separately. Actual values may be below target. Unentered planned sets remain present with blank actuals. Do not display blank as zero. A blank is pending while the date is open and skipped once the date locks.

## Home screen

- Home opens on **today** and shows a list of that date’s activities.
- Header order, left to right: **hamburger menu**, then **date selector**. The date selector opens another date. Past dates are read-only; today and future dates can be planned subject to the start-time rule below.
- The hamburger menu contains **Activities, Missions, Settings, Analytics**. Analytics is a later phase; include its navigation entry but do not invent its content.
- Activities appear in **start-time order**. The user also requested drag-and-rearrange in the date list. The exact interaction between dragging and chronological order is unresolved; propose a clear way for dragging to adjust the order without silently violating start times. Mission information should be visible, but its visual treatment is deliberately undecided. Do not force separate Mission sections that break time order. Activities without a Mission need no “Other activities” heading.
- Every compact row shows the start time, category emoji, activity name, one-line description, and a compact target/progress summary. Yes/No has its quick-tap control in this row. Keep amount and duration input controls out of the compact row.
- Tapping a row expands an accordion card showing its required image or GIF, the one-line description, and the controls for its tracking method. Only one card may be expanded at a time; all start collapsed.
- A floating **+** button sits at the **bottom left**. It opens a modal to add an existing activity or create a new activity for the **selected date only**. A new activity created here exists solely as that date’s record; it does not enter the reusable Activities library or create a repeating schedule.
- There is **no Finish day button**. Each activity is recorded individually. The date locks automatically at midnight in the time zone set in Settings.

## Planning and edit rules

- Reusable activities are created and managed in **Activities**. Their image or GIF and one-line description are required. They can be archived when no longer needed; past dated records remain.
- Activities are scheduled individually for one date or selected weekdays. A repeating activity uses the same start time on all selected weekdays. A one-date change to a repeating occurrence, including its start time, affects only that date. A change to the repeating plan affects future dates and preserves past records.
- Any change to a dated activity’s plan—time, target, Mission, or order—is allowed only **before that activity’s start time**. Actual results can be entered or corrected until that date locks.
- A scheduled activity remains in the history even if the app was never opened that day. Its planned result is blank and appears skipped after the date locks.
- Missions can be created, edited, archived, and used to group activities in list views. Drag-and-rearrange is also available where activities are organized for the routine. Mission membership is optional.
- Categories have editable names and emojis. Starter choices are editable, removable, and extendable.

## Screens and states to design

1. **Home / Today:** A realistic time-ordered list containing a multi-set reps exercise, a duration activity, a Yes/No activity, and an activity without a Mission. Show compact rows, one expanded reps card, and the bottom-left + button.
2. **Home / other date:** Date selection, future planning state, and locked past-date state.
3. **Add to date modal:** Select an existing activity or create a new date-only activity; choose its time. Show how optional Mission and category are selected when creating a new activity.
4. **Activities:** Reusable activity list, creation/edit form, category legend management, required media upload, tracking-method-specific target inputs, scheduling by date or weekdays, and archive action.
5. **Missions:** Mission list and a Mission detail view showing associated activities. Mission is a grouping, not a schedule container.
6. **Settings:** Google sign-in/account, tracker time zone, and clear offline/sync status. Initial time zone is detected from the user’s device. The one time zone set in Settings applies to all data.
7. **System states:** Offline with pending changes, syncing, synced, upload pending, and a conflict if the same dated activity is changed on two offline devices. A synced pending change and temporary upload are removed from the local queue; the small offline cache remains.

## Visual and interaction direction

Use a restrained, clean interface with strong hierarchy and minimal visual noise. The app should be fast to scan between sets. Make the difference between **target**, **actual**, **Done**, **target met**, **pending**, and **skipped** obvious without relying on color alone. The required image/GIF belongs in the expanded card, not the compact list. Respect touch accessibility, readable type, and desktop keyboard use. Show a responsive desktop layout for the same core screens.

Propose two alternative treatments for showing Mission membership in a single chronological Home list. Also propose how drag-to-reorder should work alongside scheduled start times. These are open design decisions. Do not assume a separate Mission section or a special “official Gym” Mission.

## Technical context for design

The first release serves one Google-sign-in user. Supabase Auth handles sign-in, Supabase Postgres stores data, and Supabase Storage stores activity images/GIFs. The app works offline using a local cache and a pending-change queue that clears after sync. Historical dated records remain unchanged when reusable definitions or repeating schedules change. The implementation is not yet built; this brief is for design exploration.

## Output requested from Gemini

Provide mobile screen designs first, then responsive desktop adaptations. Include a concise component inventory, interaction notes for the accordion and tracking controls, and a clickable prototype or screen flow if the design tool supports it. Clearly label the two Mission-display alternatives and explain the tradeoff in scanability.
