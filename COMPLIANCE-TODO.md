# Before you let anyone else use Inertia

I am not a lawyer and this has not been legally reviewed. Below is what I built,
what you must fill in yourself, and the risks I could not remove in code.

---

## 1. YOU MUST FILL THESE IN — the pages are unusable until you do

Open `legal.js` and replace every placeholder:

| Placeholder | What goes there |
|---|---|
| `REPLACE_DATE` | Today's date, e.g. "3 September 2026" (appears 4 times) |
| `[YOUR FULL NAME]` | Your legal name, or a company name if you register one |
| `[YOUR EMAIL]` | A real, monitored inbox — this is also your DPDP grievance contact |
| `[YOUR CITY, STATE, INDIA]` | Your city and state |
| `[YOUR CITY]` | Jurisdiction in the Terms |

A privacy policy that says `[YOUR EMAIL]` is worse than none — it signals the whole
document is boilerplate nobody read.

---

## 2. What is now in place

**Legal pages** — `/privacy.html`, `/terms.html`, `/cookies.html`, all readable in-app too.

**Consent at signup** — three separate tick boxes, none pre-ticked: age 18+ and terms,
explicit consent for health data, and acknowledgement that this is not medical advice.
Timestamps are recorded on the account. Google sign-up is gated the same way.

**Medical disclaimer** — shown before the first plan is ever generated, and always
reachable from the menu.

**Data rights** — "Download my data" exports every row we hold as JSON.
"Delete my account" wipes all rows and local storage after typing DELETE.

**Accessibility** — skip link, visible keyboard focus rings, `prefers-reduced-motion`
support (this app animates a lot), ARIA labels on every icon-only button, alt text on
images, screen-reader descriptions on all charts, and `--dim` lightened from #6b6259
to #8a8078 so small text now passes WCAG AA.

**No dark patterns** — no fake reviews, no testimonials, no invented user counts,
no "trusted by X athletes" claims. There was nothing to remove because none existed.

---

## 3. Cookie consent — you do NOT need a banner

You set no advertising, analytics or tracking cookies. Local storage is used only for
your login session (strictly necessary), your preferences, and coach history. Under
GDPR and the ePrivacy Directive, strictly necessary storage is exempt from consent.

**This changes the moment you add analytics.** If you ever enable Cloudflare Web
Analytics, Google Analytics, Meta Pixel or anything similar, you will need a real
consent banner with a genuine reject option. Do not add one casually.

---

## 4. Refund policy — not needed yet

The app is free, so there is nothing to refund, and the Terms say so explicitly.
If you ever charge money you must publish a refund policy beforehand, and Indian
consumer law will apply to how you word it.

---

## 5. Risks I could not fix in code

**Health data is the big one.** Under India's DPDP Act 2023 and the GDPR, health
information is sensitive. You are now a data fiduciary with real obligations:
respond to access and deletion requests, report breaches, and keep the grievance
contact monitored. Consent is in place, but the obligations are ongoing.

**Under-18s.** DPDP requires verifiable parental consent for children, plus a ban on
tracking them. Rather than build that, the Terms restrict use to 18+ and signup asks
users to confirm it. That is the pragmatic approach, not a bulletproof one.

**Giving training and nutrition advice.** This is the largest liability in the app.
The disclaimers are prominent and repeated, but if someone injures themselves
following an AI-generated plan, disclaimers reduce exposure rather than eliminate it.
**Consider personal liability insurance before opening this to strangers.**

**AI output is unpredictable.** Claude could generate a plan that is unsafe for a
particular person, or misread a nutrition label badly. The Terms say estimates may be
wrong. Watch for this in practice.

**Google Fonts leaks IP addresses to Google.** German courts have ruled this a GDPR
violation. It is disclosed in the cookie policy. To remove the risk entirely,
self-host the two fonts instead of loading them from Google.

**Strava's terms bind you.** Their API agreement restricts how you display and store
their data, and they can revoke access at any time. Read their developer terms if you
open this to other users, and note the Standard tier caps you at ~10 connected athletes.

**Deleting the auth record needs a service key.** "Delete my account" removes every row
of your data, but the Supabase auth user itself remains, because deleting it requires
admin privileges that cannot safely live in frontend code. The message tells users to
email you. If this matters, add a small function that does it server-side.

**Account for one user is not the same as a product.** Everything above becomes far
more serious the moment a stranger signs up. Get a lawyer to read the two policies
before that happens.

---

## 6. Genuinely worth doing next

1. Fill in the placeholders (15 minutes)
2. Have a lawyer read the privacy policy and terms (a few hours of their time)
3. Self-host the fonts if you expect European users
4. Add a server-side function to fully delete auth records
5. Look into liability insurance before opening it up
