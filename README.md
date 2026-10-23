# QuickVolunteer website (front end)

Plain HTML, CSS and JavaScript built from the QuickVolunteer Figma prototype. No frameworks and no Jinja.
The back end (Python Flask) and the MySQL database are built separately.

## How to open
Open `index.html` in a browser, or use the Live Server extension in VS Code.

## Pages
| Page | What it does | User story |
|---|---|---|
| `index.html` | Homepage | |
| `signup.html` | One account for everyone | US-01 |
| `login.html` | One login for members and the administrator | US-01 |
| `forgot-password.html` | Request a password reset link | US-01 |
| `onboarding.html` | Optional set up: area, ask or give help, skills | US-16 |
| `dashboard.html` | Main page; adapts to ask, give or both | |
| `find-a-task.html` | Search and filter tasks, best matches first | US-05, US-13 |
| `task.html?id=1` | Task details and Offer to help | US-06 |
| `post-request.html` | Post a help request | US-04 |
| `my-requests.html` | My requests: filter, close | US-09 |
| `request.html?id=1` | One request: accept or decline volunteer offers | US-07 |
| `my-tasks.html` | Upcoming tasks, offers, hours and activity history | US-08, US-14 |
| `review.html?task=2` | Confirm a task is completed and leave a review | US-10, US-15 |
| `profile.html` | Edit profile, area, skills, availability; reviews | US-02, US-03 |
| `report.html?task=5` | Report a concern | US-12 |
| `admin.html` | Admin: verify accounts, review concerns, suspend | US-11, US-12 |
| `about.html`, `impact.html`, `volunteer-guide.html`, `faqs.html`, `contact.html`, `privacy.html`, `terms.html` | Information pages | |

Prototype tip: log in with an email that starts with `admin` to open the admin page.

## Folders
- `css/styles.css` all styles (colours and fonts from the Figma styles)
- `js/main.js` all behaviour
- `assets/icons/` and `assets/images/` exported from Figma

## Notes for the back end
- The pages use demo data. In `js/main.js`, `DEMO_TASKS` and the `localStorage` profile (`qv_profile`) stand in for the API.
- Each function in `main.js` has a comment naming the request that should replace it, for example `POST /api/tasks`, `POST /api/offers/<id>/accept`, `POST /api/reports`.
- Forms only check input in the browser; Flask must validate everything again on the server.
