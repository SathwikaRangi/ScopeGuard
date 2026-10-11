import 'dotenv/config';
import * as store from './store.js';

/**
 * Creates a sample project so the app has something in it on first run.
 * Requests are inserted unanalysed — run them from the UI to watch the
 * retrieval and the verdicts happen for real.
 */

const SCOPE = `PROJECT BRIEF — Marigold Coffee Roasters website
Prepared for: Dana Whitfield, Marigold Coffee Roasters
Fixed fee: 4,200. Timeline: 6 weeks from kickoff.

1. DELIVERABLES

A five-page marketing website: Home, Our Coffee, Wholesale, About, Contact. Each page designed at desktop and mobile breakpoints and built as a responsive Webflow site.

Logo design is included: up to three initial concepts, one selected concept refined to final files (SVG, PNG, favicon).

Copywriting is supplied by the client. The designer will place and format supplied copy but will not write or rewrite page copy.

2. REVISIONS

Two rounds of revisions are included after the first full design presentation. A round means one consolidated set of feedback returned within five working days. Feedback returned after that window, or a third round, is billed at the hourly rate.

3. IMAGERY

The client supplies all photography. The designer will crop, colour-correct and optimise up to 25 supplied images for web.

4. TECHNICAL

The designer will connect the finished site to the client's existing Webflow account and publish to the client's existing domain. Ongoing hosting, domain renewal, email configuration and third-party service accounts remain the client's responsibility.

Basic on-page SEO is included: page titles, meta descriptions and alt text for the pages listed above.

5. OUT OF SCOPE

Anything not listed above, including but not limited to: e-commerce or checkout functionality, blog set-up, print collateral, social media assets, ongoing maintenance, content migration from the previous site, and training sessions.

6. RATE FOR ADDITIONAL WORK

Work outside this scope is quoted separately or billed at 85 per hour, agreed in writing before it begins.`;

const REQUESTS = [
  'Hey! Love the homepage. Could we get a blog section going too? Nothing fancy, just somewhere to post our roast notes each month.',
  'Quick one — can you tweak the green in the logo? Feels a bit dark on screen.',
  'Also our office manager will need a walkthrough of how to update the site. Maybe an hour on Zoom next week?',
  "One more thing, we'd like to sell bags directly on the site by launch. Just a simple checkout.",
  'Can you pull the product shots and about-us text across from our old Squarespace site? Should be quick.',
];

const project = store.createProject({
  name: 'Marigold Coffee Roasters website',
  client: 'Dana Whitfield',
  rate: 85,
  currency: 'USD',
  scopeText: SCOPE,
});

for (const text of REQUESTS) {
  store.createRequest(project.id, { text, source: 'seed' });
}

console.log(`Seeded "${project.name}" (${project.id})`);
console.log(`  ${project.sections.length} sections indexed`);
console.log(`  ${REQUESTS.length} requests waiting to be checked — open the app and run them.`);
