---
icon: bolt-lightning
---

# Deepthroat Trainer Software 2.0.0 Beta Preview

{% embed url="https://youtu.be/N5KAoqPdEyE" %}

## Deep Throat Trainer — Beta Update Notes

This release introduces a number of new firmware capabilities and upcoming dashboard features. All subscribers are currently enrolled in the beta stream during this rollout.

---

### Core Changes

- **New Beta Stream:** all active subscribers now receive the beta firmware automatically.
  - Dashboard toggle between _Production_, _Beta_, and _Latest_ coming soon.
- **Calibration moved to server (in progress):**
  - Each toy will be calibrated once and saved to the cloud.
  - Calibration data can be reassigned or adjusted manually in the dashboard.
  - Currently unavailable in beta but will return in the next patch.

---

### Training and Segments

- **Segment limit increased:** firmware now supports up to **1,000 segments per training**, up from three.
  - Dashboard UI for editing large segment sets is in development.
- **Segment repeat feature (Ultra exclusive):**
  - Ultra subscribers can set each segment to repeat up to 100 times.
  - Build longer, more efficient training templates without manually duplicating segments.
  - Total effective segments (including repeats) cannot exceed 100 for Ultra users.
- **Depth increase now functional:** previous versions ignored depth scaling; this is now active across all modes.
- **Segment-specific toy assignment (pending):**
  - Each segment will soon be able to use a different toy.
  - Useful for mixed-material or size-based progression training.
- **Pass/Fail feature (Ultra exclusive):**
  - Set a minimum passing grade (0-100%) for individual segments.
  - Segments below the threshold must be repeated until you pass.
  - Optional custom failure messages display on your device when you don't meet the grade.
  - Three consecutive failures on the same segment restart the entire training session from the beginning.

---

### Customization and User Control

- **Device avatar system introduced:**
  - Players are represented by an on-screen icon (turtle by default) during training.
  - Members with Ultra, Founder, and Pioneer subscriptions can customize this avatar from the Settings > My Devices page.
  - Unlock your first device avatar by reporting a bug through the Dashboard (by clicking the Help button on the bottom right, and then "Contact Support")!
  - More unlockable icons to come!
- **Full text customization (firmware-ready, dashboard pending):**
  - Every on-screen text element—rewards, punishments, grades, and UI labels—can be edited by the user.
  - Rollout to Ultra members first.
- **Hands-Free Mode (Ultra exclusive):**
  - Allows training to continue automatically without requiring continuous interaction.
  - Perfect for extended training sessions where you want uninterrupted progress.
  - Enable per training template in the dashboard.

---

### Dashboard and UI Improvements

- **Training preview:**
  - When fetching settings, users now see the training name, assigned toy, and total segments before starting.
  - Example: “Joy’s Training 101 — Toy: Pink 7-inch — 150 segments.”
- **Performance improvements:**
  - Frame rate increased to **120 Hz**, improving motion smoothness and responsiveness.
- **Speed Mode (replaces freeform dial):**
  - Measures reps per minute and visualizes them as staying above the 50% mark on the dial.
- **Unified scoring system:**
  - Freeform, Endurance, and Repetition modes now use the same formula:
    - `Score = (Time in Zone) / (Active Time)`

---

### Offline Use and Storage

- **Offline playback:**
  - Device now replays the last downloaded settings even without Wi-Fi.
  - Allows pre-loading sessions for offline use (e.g., at play parties).
- **Offline session saving (pending):**
  - Up to 100 segments can be stored locally and uploaded later when back online.

---

### Upcoming Releases

- Dashboard support for large-segment editing
- Cloud-based calibration tools
- Segment-specific toy assignment
- Customizable UI text
- Icon unlock system
- Offline session syncing
