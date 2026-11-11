const DATA_URL = "data/penrose-stats.json?v=20261111-ppdc-2";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const params = new URLSearchParams(location.search);
const page = document.body.dataset.page;
let scope = page === "details" ? (params.get("stage") || params.get("scope") || "overall") : document.body.dataset.scope;
const SCOPE_INFO = {
  overall: { title: "Overall competition", eyebrow: "Placement + group stages · Overall", intro: "Cumulative totals follow each driver’s path: their assigned Placement Race plus recorded Group A or Group B competition races." },
  preliminary: { title: "Preliminary rounds", eyebrow: "Placement stage · Barcelona", intro: "Historical placement statistics across seven Placement Races. Manually entered Results count as participation; missing fastest laps remain unavailable." },
  "group-a": { title: "Group A", eyebrow: "Placement + group stages · Group A", intro: "Cumulative totals follow Group A drivers from their assigned Placement Race into recorded Group A competition races." },
  "group-b": { title: "Group B", eyebrow: "Placement + group stages · Group B", intro: "Cumulative totals follow Group B drivers from their assigned Placement Race into recorded Group B competition races." },
};
const STAGE_OPTIONS = [
  ["overall", "Overall · Group A/B"],
  ["preliminary", "Preliminary Rounds"],
  ["group-a", "Group A"],
  ["group-b", "Group B"],
];
let sourceData;
let scopeData;
let filters = {};
let detailEventKey = "";
let driverDataSearch = "";
let driverDataFilters = {
  group: scope === "preliminary" ? "Preliminary" : scope === "group-a" ? "Group A" : scope === "group-b" ? "Group B" : "All",
  event: "", team: "", circuit: "",
};
let driverDataSort = { key: "driver", direction: "asc" };

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
function date(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" }).format(parsed);
}
function ukTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(parsed);
}
function countryFlag(countryCode) {
  if (!/^[A-Z]{2}$/.test(countryCode || "")) return "";
  const points = [...countryCode].map((letter) => 127397 + letter.charCodeAt(0));
  return String.fromCodePoint(...points);
}
function countryName(countryCode) {
  if (!/^[A-Z]{2}$/.test(countryCode || "")) return "";
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode) || ""; }
  catch (_error) { return ""; }
}
const TEAM_ACCENT_COUNT = 8;
function teamAccentIndex(teamKey, teamName = "") {
  const source = String(teamKey || teamName || "");
  let hash = 0;
  for (const character of source) hash = ((hash * 31) + character.codePointAt(0)) | 0;
  return (hash >>> 0) % TEAM_ACCENT_COUNT;
}
function teamNameMarkup(name, teamKey = "") {
  const accent = teamAccentIndex(teamKey, name);
  return `<span class="team-name-label"><span class="team-name-accent team-accent-${accent}" aria-hidden="true"></span><span class="team-name-text">${esc(name || "—")}</span></span>`;
}
function time(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return "—";
  const value = Number(ms);
  return `${Math.floor(value / 60000)}:${String(Math.floor((value % 60000) / 1000)).padStart(2, "0")}.${String(value % 1000).padStart(3, "0")}`;
}
function selectedFilters() {
  return Object.fromEntries(Object.entries(filters).map(([key, el]) => [key, el?.value || ""]));
}
function selection() {
  const selected = selectedFilters();
  if (scope === "group-a") selected.group = "Group A";
  if (scope === "group-b") selected.group = "Group B";
  return window.PenroseCore.select(scopeData, selected);
}
function scopeEvents() { return window.PenroseCore.eventsForScope(sourceData, scope); }
function detailUrl(target = scope) { return `race-details.html?stage=${encodeURIComponent(target)}`; }

function baseShell() {
  $$(".main-nav a").forEach((link) => {
    const current = page === "home" ? link.dataset.pageLink === "home"
      : page === "details" ? link.dataset.pageLink === "details" && location.pathname.endsWith("race-details.html")
      : link.dataset.scopeLink === scope;
    link.classList.toggle("active", current);
    if (current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}
function hero(title, eyebrow, intro) {
  return `<section class="hero page-hero"><div class="hero-copy"><p class="eyebrow"><span class="eyebrow-line"></span>${esc(eyebrow)}</p><h1>${title}</h1><p class="hero-subtitle">${esc(intro)}</p><a class="hero-link" href="#statistics">View statistics <span aria-hidden="true">↘</span></a></div></section>`;
}
function titleMarkup(title) {
  const words = title.split(" ");
  return `<span>${esc(words.slice(0, -1).join(" "))} <em>${esc(words.at(-1))}</em></span>`;
}
function filterPanel(events) {
  const circuits = [...new Set(events.map((event) => event.circuit).filter(Boolean))].sort();
  const pathGroup = scope === "group-a" ? "Group A" : scope === "group-b" ? "Group B" : "";
  const participations = sourceData.participations.filter((row) => events.some((event) => event.key === row.eventKey) && (!pathGroup || row.group === pathGroup));
  const teamKeys = [...new Set(participations.map((row) => row.teamKey))].sort((a, b) => (sourceData.teams.find((team) => team.key === a)?.name || a).localeCompare(sourceData.teams.find((team) => team.key === b)?.name || b));
  const driverKeys = [...new Set(participations.map((row) => row.driverKey))].sort((a, b) => (sourceData.drivers.find((driver) => driver.key === a)?.name || a).localeCompare(sourceData.drivers.find((driver) => driver.key === b)?.name || b));
  const currentFilters = selectedFilters();
  const options = (items, first, getLabel, getValue, filterKey) => `<option value="">${first}</option>${items.map((item) => {
    const value = getValue(item);
    return `<option value="${esc(value)}"${currentFilters[filterKey] === value ? " selected" : ""}>${esc(getLabel(item))}</option>`;
  }).join("")}`;
  return `<section class="filters-panel page-filters"><div class="filters-title"><span class="filter-glyph">≡</span><div><strong>Refine the view</strong><small>Filters stay within this competition stage</small></div></div><div class="filter-grid stage-filter-grid">
    <label>Event<select id="event-filter">${options(events, "All events", (item) => item.name, (item) => item.key, "event")}</select></label>
    <label>Circuit<select id="circuit-filter">${options(circuits, "All circuits", (item) => item, (item) => item, "circuit")}</select></label>
    <label>Team<select id="team-filter">${options(teamKeys, "All teams", (key) => sourceData.teams.find((team) => team.key === key)?.name || key, (key) => key, "team")}</select></label>
    <label>Driver<select id="driver-filter">${options(driverKeys, "All drivers", (key) => sourceData.drivers.find((driver) => driver.key === key)?.name || key, (key) => key, "driver")}</select></label>
  </div><button class="reset-button" id="reset-filters" type="button">Reset filters <span aria-hidden="true">↺</span></button></section>`;
}
function summaryCards(events, selected) {
  const visibleEvents = events.filter((event) => selected.participationEvents.has(event.key));
  const drivers = new Set(selected.participations.map((row) => row.driverKey));
  const teams = new Set(selected.participations.map((row) => row.teamKey));
  const sessions = visibleEvents.reduce((sum, event) => sum + event.sessions.filter((item) => ["ShortQ", "Main Race"].includes(item.session)).length, 0);
  const raceRows = sourceData.sessionEntries.filter((entry) => entry.session === "Main Race"
    && selected.allowedEvents.has(entry.eventKey)
    && (!selected.selected.team || entry.teamKey === selected.selected.team)
    && (!selected.selected.driver || entry.driverKey === selected.selected.driver)
    && (!selected.selected.group || selected.selected.group === "Overall" || entry.group === selected.selected.group));
  const raceEntered = raceRows.filter((entry) => entry.raceEntered === true).length;
  const racesParticipated = raceRows.filter((entry) => entry.raceParticipated === true).length;
  const raceTimeKeys = new Set(sourceData.bestLaps.filter((lap) => lap.session === "Main Race"
    && selected.allowedEvents.has(lap.eventKey)
    && (!selected.selected.team || lap.teamKey === selected.selected.team)
    && (!selected.selected.driver || lap.driverKey === selected.selected.driver)
    && (!selected.selected.group || selected.selected.group === "Overall" || lap.group === selected.selected.group))
    .map((lap) => `${lap.driverKey}|${lap.sessionKey}`));
  const raceTimesRecorded = raceRows.filter((entry) => raceTimeKeys.has(`${entry.driverKey}|${entry.sessionKey}`)).length;
  return `<section class="stats-grid stage-summary-grid"><article class="stat-card"><span class="stat-index">01</span><span class="stat-label">Eligible events</span><strong>${visibleEvents.length}</strong><small>Competition scope only</small></article><article class="stat-card"><span class="stat-index">02</span><span class="stat-label">Drivers</span><strong>${drivers.size}</strong><small>Unique saved identities</small></article><article class="stat-card"><span class="stat-index">03</span><span class="stat-label">Team labels</span><strong>${teams.size}</strong><small>Captured result assignments</small></article><article class="stat-card"><span class="stat-index">04</span><span class="stat-label">Race participation</span><strong>${racesParticipated} / ${raceEntered}</strong><small>Raced / result rows entered · ${raceTimesRecorded} Results lap times</small></article><article class="stat-card"><span class="stat-index">05</span><span class="stat-label">Sessions</span><strong>${sessions}</strong><small>Qualifying and main race Results</small></article></section>`;
}
function comparableCoverageLabel(cohort) {
  const circuitText = cohort.circuitSet.map(([name, count]) => `${name}${count > 1 ? ` × ${count}` : ""}`).join(" · ");
  const names = cohort.eventKeys.map((key) => scopeData.events.find((event) => event.key === key)?.name || key);
  return `${cohort.sessionCount} contributing session${cohort.sessionCount === 1 ? "" : "s"} per driver · ${circuitText} · assigned events vary across: ${names.join(", ")}`;
}
function circuitCoverageMarkup(cohort, session) {
  const circuits = (cohort?.circuitSet || []).map(([name, count]) => `${name}${count > 1 ? ` × ${count}` : ""}`);
  if (!circuits.length) return "Circuit details unavailable";
  const title = session === "ShortQ" ? "Qualifying" : "Race Fastest Laps";
  const count = Number(cohort.sessionCount) || 0;
  return `Cumulative ${title} — ${count} ${count === 1 ? "Race" : "Races"} · ${circuits.join(" + ")}`;
}
function statisticsScopeContext(selected) {
  const events = (scopeData.events || []).filter((event) => selected.allowedEvents.has(event.key));
  const circuits = [...new Set(events.map((event) => event.circuit).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const title = scope === "overall" ? "Overall Championship Statistics"
    : scope === "preliminary" ? "Preliminary Round Statistics"
      : `${scope === "group-a" ? "Group A" : "Group B"} Championship Statistics`;
  const filterCircuit = selected.selected.circuit;
  const circuitLabel = filterCircuit
    ? `Circuit filter · ${filterCircuit}`
    : circuits.length > 1 ? `All Circuits · ${circuits.join(" · ")}`
      : circuits.length === 1 ? `Circuit · ${circuits[0]}` : "Circuit details unavailable";
  return `<p class="statistics-scope-context"><strong>${esc(title)}</strong><span>${esc(circuitLabel)}</span></p>`;
}
function cumulativeMainCard(session, title, index, selected) {
  const cohort = window.PenroseCore.comparableCumulative(scopeData, selected, session);
  const detail = `<a class="detail-link" href="${detailUrl(scope)}">View Details →</a>`;
  if (!cohort) {
    return `<article class="leaderboard-card cumulative-card"><div class="card-heading"><div><span class="card-overline">${index} / ${session === "ShortQ" ? "QUALIFYING" : "MAIN RACE"}</span><h3>${esc(title)}</h3></div><span class="card-icon">Σ</span></div><p class="empty-state">Awaiting verified lap times.</p><details class="ranking-info"><summary>Ranking method</summary><p>Valid best laps are summed across each driver’s eligible competition path. Only drivers with complete comparable session coverage are ranked.</p></details>${detail}</article>`;
  }
  const rows = cohort.rows.slice(0, 5);
  const htmlRows = rows.map((row, i) => `<tr><td class="rank">${String(i + 1).padStart(2, "0")}</td><td class="driver-cell"><span class="driver-name">${esc(row.driver)}</span></td><td>${teamNameMarkup(row.team, row.teamKey)}</td><td class="lap-time">${time(row.totalMilliseconds)}</td></tr>`).join("");
  const incomplete = cohort.incompleteCount ? `${cohort.incompleteCount} drivers with incomplete paths are excluded. ` : "";
  const otherCoverage = cohort.excludedCoverageCount ? `${cohort.excludedCoverageCount} complete drivers with different coverage are excluded from this comparison. ` : "";
  const info = `Each driver contributes their fastest valid Race Director Results lap from the assigned Preliminary Race and subsequent group races. Race participation comes from Main Race Results rows and recorded status, independently of telemetry or lap-time availability. Drivers are ranked only when they have complete times for the same comparable session set. ${cohort.sessionCount} ${session === "Main Race" ? "participated races" : "qualifying result sessions"} and the same number of valid Results times contribute per driver. Qualifying sessions with no valid Results times for anyone are exempt. ${cohort.rows.length} drivers qualify. ${incomplete}${otherCoverage}Coverage: ${comparableCoverageLabel(cohort)}.`;
  return `<article class="leaderboard-card cumulative-card"><div class="card-heading"><div><span class="card-overline">${index} / ${session === "ShortQ" ? "QUALIFYING" : "MAIN RACE"}</span><h3>${esc(title)}</h3></div><span class="card-icon">Σ</span></div><p class="leaderboard-circuit-context">${esc(circuitCoverageMarkup(cohort, session))}</p><div class="table-scroll"><table class="main-cumulative-table"><thead><tr><th>Rank</th><th>Driver</th><th>Team</th><th>Cumulative total</th></tr></thead><tbody>${htmlRows}</tbody></table></div><details class="ranking-info"><summary>Ranking method and eligibility</summary><p>${esc(info)}</p></details>${detail}</article>`;
}
function awaitingCard(title, symbol, description) {
  return `<article class="unavailable-card future-stat-card"><span class="unavailable-symbol">${symbol}</span><div><span class="card-overline">PENROSE CUP STATISTICS</span><h3>${esc(title)}</h3><p><strong>Awaiting verified data</strong><br>${esc(description)}</p></div><span class="unavailable-badge">AWAITING DATA</span></article>`;
}
function penaltyTime(seconds) {
  return `${Number(seconds).toLocaleString("en-GB", { maximumFractionDigits: 3 })}s`;
}
function nextRaceSetupMarkup(next) {
  const sprintSettings = next.sprint === "Yes"
    ? `Yes${next.sprintType ? ` · ${next.sprintType}` : ""}` : next.sprint;
  const setup = [
    ["Race distance", next.raceDistance], ["Qualifying", next.qualifyingFormat],
    ["Weather", next.weather], ["Session format", next.sessionType || (next.sessionRoles || []).join(" · ")],
    ["Sprint settings", sprintSettings], ["Game", "F1 26 DLC"], ["Scoring mode", next.classScoringMode],
  ].filter(([, value]) => value !== null && value !== undefined && value !== "");
  return setup.length ? `<dl class="next-race-setup">${setup.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>` : "";
}
function fullRaceDate(value) {
  if (!value) return "Date to be announced";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(parsed);
}
function raceStartMarkup(value) {
  const visitorZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const display = window.PenroseCore.raceTimeDisplay(value, visitorZone);
  if (!display) return "<strong>TBA UK</strong>";
  const localTime = display.sameAsUK ? "" : `<span class="local-start-time"> · ${esc(display.localTime)} Your Time</span>`;
  const localDate = display.dateDiffers ? `<small class="local-start-date">Local date: ${esc(display.localDate)}</small>` : "";
  return `<strong>${esc(display.ukTime)} UK${localTime}</strong>${localDate}`;
}
function nextRacePrimaryMarkup(next) {
  const country = countryName(next.countryCode);
  const circuit = next.circuit ? `<span class="next-race-circuit">${esc(next.circuit)}${country ? `<small class="next-race-country">${esc(country)}</small>` : ""}</span>` : "";
  const groupTimes = next.groupStartTimes || {};
  return `<div class="next-race-primary">${circuit}<span class="next-race-date">${esc(fullRaceDate(next.date))}</span></div><div class="next-race-start-times"><div><span>GROUP A</span><div class="start-time-stack">${raceStartMarkup(groupTimes["Group A"])}</div></div><div><span>GROUP B</span><div class="start-time-stack">${raceStartMarkup(groupTimes["Group B"])}</div></div></div>`;
}
function nextRaceCard() {
  const next = sourceData.nextRace || { available: false, title: "TBA" };
  const setupMarkup = nextRaceSetupMarkup(next);
  const countryKey = /^[A-Z]{2}$/.test(next.countryCode || "") ? next.countryCode.toLowerCase() : "";
  const countryClass = next.available && countryKey ? ` has-country-flag flag-${countryKey}` : "";
  const flagArt = countryClass ? `<span class="next-race-flag-art" aria-hidden="true">${countryFlag(next.countryCode)}</span>` : "";
  const grandPrix = next.grandPrixName || next.round || next.title || "Next Race";
  const weekendNotice = next.available && next.weekendNotice
    ? `<div class="next-race-weekend-notice"><span aria-hidden="true">✦</span> NO WILDCARDS THIS WEEKEND</div>`
    : "";
  return `<section class="next-race-card next-race-hero${countryClass}">${flagArt}<div class="next-race-copy"><span class="race-panel-overline">PENROSE CUP — NEXT RACE</span>${weekendNotice}${next.available ? `<p class="next-race-round">${esc(next.round || "Competition round")}</p><h2>${esc(grandPrix.toUpperCase())}</h2>${nextRacePrimaryMarkup(next)}${setupMarkup}` : `<p class="next-race-round">Competition round</p><h2>TBA</h2><p class="next-race-tba">No active, non-archived Group/Pot event is currently scheduled.</p>`}</div></section>`;
}
function prizePoolTotal() {
  const amount = Number(window.PENROSE_SITE_CONFIG?.prizePoolTotalGBP);
  return Number.isFinite(amount) && amount >= 0
    ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(amount)
    : "TBA";
}
function openingHero() {
  return `<section class="home-opening" aria-labelledby="home-opening-title"><div class="home-opening-art" aria-hidden="true"></div><div class="home-opening-content"><div class="home-opening-copy"><span class="opening-kicker"><span class="opening-kicker-mark" aria-hidden="true"></span>THE ROAD TO THE CROWN</span><h1 id="home-opening-title">PENROSE<br><span>CUP</span></h1><p>Every round. Every team. One championship.</p><div class="opening-checker" aria-hidden="true"></div></div><aside class="prize-pool-feature" aria-label="Penrose Cup prize pool"><span class="prize-feature-label">TOTAL PRIZE POOL</span><strong>${esc(prizePoolTotal())}</strong><a href="#prize-breakdown">View prize breakdown <span aria-hidden="true">↘</span></a></aside></div><div class="opening-bottomline"><span>OFFICIAL COMPETITION HUB</span><span>GROUP STAGE · SEASON 2026</span></div></section>`;
}
function prizeBreakdownSection() {
  const config = window.PENROSE_SITE_CONFIG || {};
  const imagePath = typeof config.prizeBreakdownImage === "string" ? config.prizeBreakdownImage.trim() : "";
  const graphic = imagePath
    ? `<figure class="prize-breakdown-figure"><a class="prize-breakdown-image-link" href="${esc(imagePath)}" target="_blank" rel="noopener" aria-label="Open the prize pool breakdown graphic at full size"><img class="prize-breakdown-image" src="${esc(imagePath)}" alt="${esc(config.prizeBreakdownAlt || "Penrose Cup prize pool breakdown graphic")}"><span>Open full size ↗</span></a><figcaption>Prize categories and amounts are shown as supplied. Their appearance here does not imply that every category is measured or verified by Race Director telemetry.</figcaption></figure>`
    : `<div class="prize-breakdown-pending"><span class="prize-pending-icon" aria-hidden="true">£</span><div><strong>Prize breakdown graphic</strong><p>The source graphic has not been added to the project yet. Its prize categories and amounts are not transcribed or estimated.</p></div></div>`;
  return `<section class="prize-breakdown-section" id="prize-breakdown" aria-labelledby="prize-breakdown-title"><div class="prize-breakdown-heading"><div><span class="opening-kicker">PENROSE CUP · PRIZE POOL</span><h2 id="prize-breakdown-title">Prize <em>breakdown</em></h2></div><strong class="prize-breakdown-total">${esc(prizePoolTotal())} total</strong></div>${graphic}</section>`;
}
function standingsHeading(label, explanation, tooltipTitle = "", infoIcon = false) {
  const accessibleText = tooltipTitle ? `${tooltipTitle}. ${explanation}` : `${label}: ${explanation}`;
  const titleAttribute = tooltipTitle ? ` data-tooltip-title="${esc(tooltipTitle)}"` : "";
  const icon = infoIcon ? '<span class="standings-tooltip-icon" aria-hidden="true">ⓘ</span>' : "";
  return `<th><button class="standings-tooltip-trigger${infoIcon ? " has-info-icon" : ""}" type="button" aria-expanded="false" aria-label="${esc(accessibleText)}" data-tooltip="${esc(explanation)}"${titleAttribute}>${esc(label)}${icon}</button></th>`;
}
const DC_TOOLTIP_TITLE = "DC — Driver Compliance Deduction";
const DC_TOOLTIP = `The four drivers who raced for a team in the Week 1 Placement Round become that team's Original Placement Drivers for the remainder of the Penrose Cup.

From Week 2 onwards, teams are expected to field at least two of those original four drivers in each race.

4 originals or 3 originals: No deduction.

2 originals + 2 replacements: No deduction.

1 original + 3 replacements: The highest-scoring replacement loses 50% of their points.

0 originals + 4 replacements: The two highest-scoring replacements each lose 50% of their points.

Deductions affect the team's championship total only, not the drivers' finishing positions. Points are calculated after finishing-position and bonus points have been added. Any 50% deduction is rounded down to the nearest whole point.

Each race is assessed independently.`;
let activeStandingsTooltip = null;
function hideStandingsTooltip() {
  if (!activeStandingsTooltip) return;
  if (activeStandingsTooltip.button) activeStandingsTooltip.button.setAttribute("aria-expanded", "false");
  if (activeStandingsTooltip.button) activeStandingsTooltip.button.removeAttribute("aria-describedby");
  activeStandingsTooltip.button = null;
  activeStandingsTooltip.node.hidden = true;
}
function showStandingsTooltip(button) {
  if (!activeStandingsTooltip) {
    const node = document.createElement("div");
    node.className = "standings-tooltip-popover";
    node.id = "standings-tooltip-popover";
    node.setAttribute("role", "tooltip");
    node.hidden = true;
    document.body.append(node);
    activeStandingsTooltip = { node, button: null };
  }
  if (activeStandingsTooltip.button && activeStandingsTooltip.button !== button) {
    activeStandingsTooltip.button.setAttribute("aria-expanded", "false");
    activeStandingsTooltip.button.removeAttribute("aria-describedby");
  }
  activeStandingsTooltip.button = button;
  const title = button.dataset.tooltipTitle || "";
  const explanation = button.dataset.tooltip || button.getAttribute("aria-label") || "";
  activeStandingsTooltip.node.replaceChildren();
  if (title) {
    const heading = document.createElement("strong");
    heading.className = "standings-tooltip-title";
    heading.textContent = title;
    const body = document.createElement("span");
    body.className = "standings-tooltip-copy";
    body.textContent = explanation;
    activeStandingsTooltip.node.append(heading, body);
  } else {
    activeStandingsTooltip.node.textContent = explanation;
  }
  activeStandingsTooltip.node.hidden = false;
  button.setAttribute("aria-expanded", "true");
  button.setAttribute("aria-describedby", activeStandingsTooltip.node.id);
  const rect = button.getBoundingClientRect();
  const tooltip = activeStandingsTooltip.node;
  const left = Math.max(8, Math.min(window.innerWidth - tooltip.offsetWidth - 8, rect.left + rect.width / 2 - tooltip.offsetWidth / 2));
  const belowTop = rect.bottom;
  const aboveTop = rect.top - tooltip.offsetHeight;
  const top = belowTop + tooltip.offsetHeight <= window.innerHeight - 8
    ? belowTop
    : Math.max(8, aboveTop);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}
function wireStandingsTooltips() {
  if (!document.addEventListener || !document.body?.dataset) return;
  if (document.body.dataset.standingsTooltipsWired) return;
  document.body.dataset.standingsTooltipsWired = "true";
  document.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "mouse") return;
    const button = event.target.closest?.(".standings-tooltip-trigger");
    if (button) showStandingsTooltip(button);
  });
  document.addEventListener("pointerout", (event) => {
    if (event.pointerType !== "mouse") return;
    const fromTrigger = event.target.closest?.(".standings-tooltip-trigger");
    const fromTooltip = event.target.closest?.(".standings-tooltip-popover");
    const toTrigger = event.relatedTarget?.closest?.(".standings-tooltip-trigger");
    const toTooltip = event.relatedTarget?.closest?.(".standings-tooltip-popover");
    if ((fromTrigger || fromTooltip) && !toTrigger && !toTooltip) hideStandingsTooltip();
  });
  document.addEventListener("focusin", (event) => {
    const button = event.target.closest?.(".standings-tooltip-trigger");
    if (button) showStandingsTooltip(button);
  });
  document.addEventListener("focusout", (event) => {
    if (event.target.closest?.(".standings-tooltip-trigger")) setTimeout(() => {
      if (!document.activeElement?.closest?.(".standings-tooltip-trigger")) hideStandingsTooltip();
    }, 0);
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.(".standings-tooltip-trigger");
    if (button) {
      if (event.pointerType === "mouse" || event.detail === 0) return;
      if (button.getAttribute("aria-expanded") === "true") hideStandingsTooltip();
      else showStandingsTooltip(button);
      return;
    }
    if (!event.target.closest?.(".standings-tooltip-popover")) hideStandingsTooltip();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideStandingsTooltip();
  });
  window.addEventListener("scroll", hideStandingsTooltip, true);
}
function groupStageStandings(group) {
  const standings = sourceData.groupStage?.groups?.[group];
  if (!standings) return "";
  const boundary = window.PenroseCore.qualificationBoundary(standings);
  const stage = standings.eliminationNoticeStage || standings.competitionStage || standings.stage || "Group Stage";
  const eliminationNotice = window.PenroseCore.eliminationNotice(group, stage);
  const groupB = group === "Group B";
  const columnCount = groupB ? 7 : 6;
  const eliminationStatus = standings.stageStatus === "CONFIRMED"
    ? "Results confirmed"
    : "Provisional points · no teams eliminated";
  const rows = standings.teams.map((team, index) => {
    const pos = team.position ?? "—";
    const provisionalRisk = boundary.isGroupStage && !boundary.confirmed && boundary.lineAfter !== null
      && Number.isFinite(Number(team.position)) && Number(team.position) > boundary.cutoff;
    const classes = [team.eliminated ? "eliminated-team" : "", provisionalRisk ? "provisional-drop-zone" : ""].filter(Boolean).join(" ");
    const zoneHeading = index === 0 && boundary.qualifyingZoneLabel
      ? `<tr class="standings-zone-heading qualifying-zone-heading"><td colspan="${columnCount}">${esc(boundary.qualifyingZoneLabel)}</td></tr>`
      : "";
    const dropZoneHeading = boundary.lineAfter === index && boundary.dropZoneLabel
      ? `<tr class="standings-zone-heading drop-zone-heading"><td colspan="${columnCount}"><strong>${esc(boundary.dropZoneLabel)}</strong></td></tr>`
      : "";
    const deductionCell = (value, className) => {
      if (value == null) return `<td class="${className}">N/A</td>`;
      const amount = Number(value);
      return `<td class="${className}">${amount > 0 ? `−${amount.toLocaleString("en-GB")}` : "—"}</td>`;
    };
    const complianceCell = groupB ? deductionCell(team.driverComplianceDeductions, "compliance-deduction-points") : "";
    const row = `${zoneHeading}${dropZoneHeading}<tr class="${classes}"><td class="rank">${esc(pos)}</td><td class="group-team-name">${teamNameMarkup(team.name, team.key)}</td><td>${team.race1Points == null ? "—" : Number(team.race1Points).toLocaleString("en-GB")}</td><td>${team.race2Points == null ? "—" : Number(team.race2Points).toLocaleString("en-GB")}</td>${deductionCell(team.ppDeductions, "pp-deduction-points")}${complianceCell}<td class="lap-time">${team.totalPoints == null ? "—" : Number(team.totalPoints).toLocaleString("en-GB")}</td></tr>${boundary.lineAfter === index + 1 ? `<tr class="elimination-divider${boundary.dropZoneLabel ? " drop-zone-divider" : ""}"><td colspan="${columnCount}"><span class="qualification-rule"></span><strong>${esc(boundary.label)}</strong>${boundary.confirmed ? `<small> · BOTTOM ${standings.teams.length - boundary.cutoff} ELIMINATED</small>` : ""}</td></tr>` : ""}`;
    return row;
  }).join("");
  const tieMessage = boundary.tie ? `<p class="group-stage-alert">Tie at the qualification cutoff; qualification is undecided.</p>` : "";
  const headers = `${standingsHeading("R1", "Group Race 1 Points")}${standingsHeading("R2", "Group Race 2 Points")}${standingsHeading("PP", "Converted Time Penalty — This penalty is issued when a driver DNFs but receives a time penalty from the stewards. The time penalty is converted into a championship points deduction.", "", true)}${groupB ? standingsHeading("DC", DC_TOOLTIP, DC_TOOLTIP_TITLE, true) : ""}${standingsHeading("TOTAL", "Total Championship Points After Deductions")}`;
  return `<section class="group-stage-section"><div class="group-standings-heading"><h2>${esc(group.toUpperCase())} — STANDINGS</h2><span class="group-stage-status">${esc(standings.stageStatus)}</span></div><div class="elimination-notice"><span class="elimination-notice-icon" aria-hidden="true">↘</span><strong>${esc(eliminationNotice)}</strong><small>${esc(eliminationStatus)}</small></div><div class="group-race-statuses"><span>R1 <strong>${esc(standings.race1Status)}</strong></span><span>R2 <strong>${esc(standings.race2Status)}</strong></span></div>${tieMessage}<div class="group-standings-card${groupB ? " group-b-standings-card" : ""}"><table class="group-standings-table${groupB ? " group-b-standings-table" : ""}"><colgroup><col class="position-column"><col class="team-column"><col class="points-column"><col class="points-column"><col class="deduction-column">${groupB ? '<col class="compliance-column">' : ""}<col class="total-column"></colgroup><thead><tr><th>POS</th><th>TEAM</th>${headers}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
function noStageResultsStats(selected) {
  const emptyLap = (title, index) => `<article class="leaderboard-card"><div class="card-heading"><div><span class="card-overline">${index}</span><h3>${esc(title)}</h3></div><span class="card-icon">—</span></div><p class="empty-state">No results are available in this competition scope.</p></article>`;
  return `<section class="section-block leaderboard-section phase4d-statistics"><div class="section-heading"><div><p class="eyebrow">Driver performance</p><h2>Performance <em>Leaderboards</em></h2><p class="performance-subtitle">Fast laps and standout performances across the Penrose Cup.</p></div></div>${statisticsScopeContext(selected)}<div class="leaderboard-grid">${emptyLap("Fastest Qualifying — Cumulative Lap Times", "01 / QUALIFYING")}${emptyLap("Fastest Race Laps — Cumulative Lap Times", "02 / MAIN RACE")}</div></section>`;
}
function mainStatistics(selected) {
  return `<section class="section-block leaderboard-section phase4d-statistics" id="statistics"><div class="section-heading"><div><p class="eyebrow">Driver performance</p><h2>Performance <em>Leaderboards</em></h2><p class="performance-subtitle">Fast laps and standout performances across the Penrose Cup.</p></div></div>${statisticsScopeContext(selected)}<div class="leaderboard-grid">${cumulativeMainCard("ShortQ", "Fastest Qualifying — Cumulative Lap Times", "01", selected)}${cumulativeMainCard("Main Race", "Fastest Race Laps — Cumulative Lap Times", "02", selected)}</div></section>`;
}
function missingCoverage(events) {
  if (scope !== "preliminary") return "";
  const sessions = events.flatMap((event) => event.sessions.filter((item) => ["ShortQ", "Main Race"].includes(item.session)).map((item) => ({ ...item, eventName: event.name, circuit: event.circuit })));
  const missing = sessions.filter((item) => item.lapHistoryState === "missing");
  const coverage = sourceData.coverage;
  return `<section class="section-block coverage-section page-coverage"><details class="coverage-disclosure"><summary><span>Data coverage and exceptions</span><small>${missing.length} sessions without lap-history records</small></summary><div class="coverage-disclosure-content"><div class="section-heading"><div><p class="eyebrow">Preliminary round coverage</p><h2>Results and <em>telemetry coverage.</em></h2></div></div><div class="coverage-grid"><article class="coverage-card coverage-primary"><span class="card-overline">RESULTS TIMES WITHOUT TELEMETRY</span><h3>${coverage.qualifyingResultLapsWithoutTelemetry} qualifying · ${coverage.raceResultLapsWithoutTelemetry} race</h3><p>Race Director Results times remain eligible even when lap-history telemetry is unavailable.</p></article><article class="coverage-card"><span class="card-overline">NO LAP HISTORY</span><h3>${missing.length} sessions</h3><p>Placement Race 3 qualifying, Placement Race 3 main race and Placement Race 6 qualifying have no telemetry lap history.</p></article><article class="coverage-card"><span class="card-overline">NO VALID RESULTS TIME</span><h3>${coverage.qualifyingRowsWithoutBestTime} qualifying · ${coverage.raceRowsWithoutBestTime} race</h3><p>These result rows contain no usable saved best-lap time and display N/A. No substitute values are inferred.</p></article></div><div class="table-scroll"><table class="coverage-table"><thead><tr><th>Event</th><th>Session</th><th>Valid captured laps</th><th>Coverage</th></tr></thead><tbody>${sessions.map((item) => `<tr><td>${esc(item.eventName)}<small>${esc(item.circuit)} · ${esc(date(item.date))}</small></td><td>${item.session === "ShortQ" ? "Qualifying" : "Main Race"}</td><td>${Number(item.validLaps || 0).toLocaleString()}</td><td><span class="state-pill ${item.lapHistoryState === "missing" ? "missing" : "complete"}">${item.lapHistoryState === "missing" ? "No lap history" : "History captured"}</span></td></tr>`).join("")}</tbody></table></div></div></details></section>`;
}
function emptyCompetition(events) {
  if (events.length) return "";
  const label = scope === "overall" ? "Group A/B" : scope === "group-a" ? "Group A" : "Group B";
  const message = scope === "overall"
    ? "Group competition events are not captured yet. Placement results remain part of each driver’s overall cumulative path when group rounds are added."
    : `${label} competition events have not been captured yet. This page already includes placement results for drivers assigned to this group; group-round totals will be added as results arrive.`;
  return `<section class="empty-state competition-empty"><span class="card-overline">NO GROUP-STAGE RESULTS</span><h2>${esc(label)} competition results are not available yet.</h2><p>${esc(message)}</p>${scope !== "preliminary" ? `<a class="hero-link" href="preliminary.html">View preliminary rounds <span aria-hidden="true">↗</span></a>` : ""}${page === "details" ? "" : `<a class="detail-link" href="${detailUrl(scope)}">View Details →</a>`}</section>${page === "details" ? "" : noStageResultsStats(selection())}`;
}
function mainPageContent() {
  const events = scopeEvents();
  scopeData = { ...sourceData, events };
  const info = SCOPE_INFO[scope] || SCOPE_INFO.preliminary;
  const lead = hero(titleMarkup(info.title), info.eyebrow, info.intro);
  const next = nextRaceCard();
  if (!events.length) return `${lead}${next}${emptyCompetition(events)}`;
  const selected = selection();
  return `${lead}${next}${scope === "group-a" ? groupStageStandings("Group A") : scope === "group-b" ? groupStageStandings("Group B") : ""}<section class="section-block stage-overview"><div class="section-heading"><div><p class="eyebrow">Competition scope</p><h2>${esc(info.title)} <em>only.</em></h2></div><p class="section-note">${events.length} eligible event${events.length === 1 ? "" : "s"} · preliminary and group stages stay separate.</p></div>${filterPanel(events)}<div id="stage-summary">${summaryCards(events, selected)}</div><p class="table-footnote" id="active-filter-note">Filters apply to cumulative statistics within this competition stage.</p></section><div id="main-statistics">${mainStatistics(selected)}</div>${missingCoverage(events)}`;
}
function homePageContent() {
  return `${openingHero()}${nextRaceCard()}<div class="home-group-standings-grid">${groupStageStandings("Group A")}${groupStageStandings("Group B")}</div>${prizeBreakdownSection()}`;
}
function formatLapCell(lap) {
  if (!lap) return "—";
  return `<span class="lap-time">${time(lap.milliseconds)}</span>`;
}
const DRIVER_DATA_COLUMNS = [
  { key: "driver", label: "Driver", sortable: true, type: "text" },
  { key: "team", label: "Team", sortable: true, type: "text" },
  { key: "group", label: "Group" },
  { key: "event", label: "Race / Round" },
  { key: "circuit", label: "Circuit" },
  { key: "raceStatus", label: "Race Status" },
  { key: "racePoints", label: "Race Points", sortable: true, type: "number" },
  { key: "racesEntered", label: "Races Entered", sortable: true, type: "number" },
  { key: "racesParticipated", label: "Races Raced", sortable: true, type: "number" },
  { key: "startingGridPosition", label: "Starting Grid", sortable: true, type: "number" },
  { key: "finishingPosition", label: "Finishing Position", sortable: true, type: "number" },
  { key: "positionsGained", label: "Positions Gained", sortable: true, type: "number" },
  { key: "qualifyingLap", label: "Fastest Qualifying Lap", sortable: true, type: "lap" },
  { key: "raceLap", label: "Fastest Race Lap", sortable: true, type: "lap" },
  { key: "gamePenaltySeconds", label: "Game Penalties", sortable: true, type: "number" },
  { key: "stewardPenaltySeconds", label: "Steward Penalties", sortable: true, type: "number" },
  { key: "combinedPenaltySeconds", label: "Total Penalties", sortable: true, type: "number" },
];
function normalizeSearch(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase();
}
function allDriverDataRows() {
  return window.PenroseCore.raceBreakdown(sourceData, sourceData.events || []);
}
function driverDataFilterMarkup(rows, events) {
  const options = (values, selected, emptyLabel, valueOf, labelOf) => `<option value="">${emptyLabel}</option>${values.map((item) => {
    const value = valueOf(item);
    return `<option value="${esc(value)}"${selected === value ? " selected" : ""}>${esc(labelOf(item))}</option>`;
  }).join("")}`;
  const eventList = [...events].sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.name.localeCompare(b.name));
  const teams = [...new Map(rows.map((row) => [row.teamKey, { key: row.teamKey, name: row.team }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  const circuits = [...new Set(rows.map((row) => row.circuit).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const groups = ["Preliminary", "Group A", "Group B"];
  return `<section class="filters-panel page-filters driver-data-filters" aria-label="Driver Data filters">
    <div class="driver-search-block"><label for="driver-search">Search Driver</label><div class="driver-search-row"><input id="driver-search" type="search" autocomplete="off" placeholder="Enter a full or partial driver name" value="${esc(driverDataSearch)}"><button id="clear-driver-search" type="button" aria-label="Clear driver search">Clear</button></div></div>
    <div class="driver-filter-grid">
      <label>Group<select id="driver-group-filter">${options(groups, driverDataFilters.group === "All" ? "" : driverDataFilters.group, "All groups", (item) => item, (item) => item)}</select></label>
      <label>Race / Round<select id="driver-event-filter">${options(eventList, driverDataFilters.event, "All races / rounds", (item) => item.key, (item) => item.name)}</select></label>
      <label>Team<select id="driver-team-filter">${options(teams, driverDataFilters.team, "All teams", (item) => item.key, (item) => item.name)}</select></label>
      <label>Circuit<select id="driver-circuit-filter">${options(circuits, driverDataFilters.circuit, "All Circuits", (item) => item, (item) => item)}</select></label>
    </div>
    <button class="reset-button driver-reset-button" id="reset-driver-data" type="button">Reset filters <span aria-hidden="true">↺</span></button>
  </section>`;
}
function driverDataSortValue(row, key) {
  if (key === "qualifyingLap") return row.qualifyingLap?.milliseconds ?? null;
  if (key === "raceLap") return row.raceLap?.milliseconds ?? null;
  if (key === "gamePenaltySeconds") return row.penaltyAvailable ? row.gamePenaltySeconds : null;
  if (key === "stewardPenaltySeconds") return row.penaltyAvailable ? row.stewardPenaltySeconds : null;
  if (key === "combinedPenaltySeconds") return row.penaltyAvailable ? row.combinedPenaltySeconds : null;
  return row[key] ?? null;
}
function sortDirectionFor(key) {
  return ["positionsGained", "gamePenaltySeconds", "stewardPenaltySeconds", "combinedPenaltySeconds"].includes(key) ? "desc" : "asc";
}
function filteredDriverDataRows() {
  const query = normalizeSearch(driverDataSearch).trim();
  const rows = allDriverDataRows().filter((row) => {
    if (driverDataFilters.group === "Preliminary" && row.stage !== "Placement Race") return false;
    if (["Group A", "Group B"].includes(driverDataFilters.group) && row.group !== driverDataFilters.group) return false;
    if (driverDataFilters.event && row.eventKey !== driverDataFilters.event) return false;
    if (driverDataFilters.team && row.teamKey !== driverDataFilters.team) return false;
    if (driverDataFilters.circuit && row.circuit !== driverDataFilters.circuit) return false;
    return !query || normalizeSearch(row.driver).includes(query);
  });
  const column = DRIVER_DATA_COLUMNS.find((item) => item.key === driverDataSort.key) || DRIVER_DATA_COLUMNS[0];
  const multiplier = driverDataSort.direction === "desc" ? -1 : 1;
  return rows.sort((a, b) => {
    const aValue = driverDataSortValue(a, column.key);
    const bValue = driverDataSortValue(b, column.key);
    const aMissing = aValue === null || aValue === undefined || (column.type !== "text" && !Number.isFinite(Number(aValue)));
    const bMissing = bValue === null || bValue === undefined || (column.type !== "text" && !Number.isFinite(Number(bValue)));
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (!aMissing) {
      let comparison;
      if (column.type === "text") comparison = String(aValue).localeCompare(String(bValue), "en", { sensitivity: "base" });
      else comparison = Number(aValue) - Number(bValue);
      if (comparison) return comparison * multiplier;
    }
    return (a.date || "").localeCompare(b.date || "") || a.event.localeCompare(b.event) || a.driverKey.localeCompare(b.driverKey);
  });
}
function positionLabel(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0 ? `P${Number(value)}` : "—";
}
function gainMarkup(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  const label = number > 0 ? `+${number}` : String(number);
  const kind = number > 0 ? "positive" : number < 0 ? "negative" : "neutral";
  return `<span class="positions-gained ${kind}">${esc(label)}</span>`;
}
function driverDataTableHeader() {
  return DRIVER_DATA_COLUMNS.map((column) => {
    if (!column.sortable) return `<th scope="col">${esc(column.label)}</th>`;
    const active = driverDataSort.key === column.key;
    const direction = active ? driverDataSort.direction : "none";
    const arrow = active ? (driverDataSort.direction === "asc" ? "↑" : "↓") : "↕";
    return `<th scope="col" aria-sort="${direction === "none" ? "none" : direction === "asc" ? "ascending" : "descending"}"><button type="button" class="driver-sort${active ? " active" : ""}" data-driver-sort="${esc(column.key)}">${esc(column.label)} <span aria-hidden="true">${arrow}</span></button></th>`;
  }).join("");
}
function driverDataTableRow(row) {
  const gainClass = row.positionsGained > 0 ? "positive" : row.positionsGained < 0 ? "negative" : "neutral";
  const raceStatus = row.raceEntered
    ? (row.raceStatus || (row.raceParticipationState === "unverified" ? "Unverified" : row.raceParticipated ? "Result entered" : "Not started"))
    : "—";
  const racePoints = row.racePoints === null || row.racePoints === undefined ? "—" : String(row.racePoints);
  return `<tr data-driver-key="${esc(row.driverKey)}" data-event-key="${esc(row.eventKey)}"><td class="driver-cell"><span class="driver-name">${esc(row.driver)}</span></td><td>${teamNameMarkup(row.team, row.teamKey)}</td><td>${esc(row.group || "Unassigned")}</td><td class="driver-race-cell">${esc(row.event)}<small>${esc(date(row.date))}</small></td><td>${esc(row.circuit || "—")}</td><td class="race-status-value">${esc(raceStatus)}</td><td class="numeric-position">${esc(racePoints)}</td><td class="numeric-position">${Number(row.racesEntered || 0)}</td><td class="numeric-position">${Number(row.racesParticipated || 0)}</td><td class="numeric-position">${positionLabel(row.startingGridPosition)}</td><td class="numeric-position">${positionLabel(row.finishingPosition)}</td><td>${gainMarkup(row.positionsGained)}</td><td>${formatLapCell(row.qualifyingLap)}</td><td>${formatLapCell(row.raceLap)}</td><td class="penalty-value">${row.penaltyAvailable ? penaltyTime(row.gamePenaltySeconds) : "—"}</td><td class="penalty-value steward-penalty">${row.penaltyAvailable ? penaltyTime(row.stewardPenaltySeconds) : "—"}</td><td class="penalty-value total-penalty">${row.penaltyAvailable ? penaltyTime(row.combinedPenaltySeconds) : "—"}</td></tr>`;
}
function driverDataBody(rows) {
  if (!rows.length) {
    const message = driverDataSearch.trim()
      ? `No driver or race records match “${esc(driverDataSearch.trim())}”. Try a shorter name or clear a filter.`
      : "No race records match these filters.";
    return `<tr><td class="empty-row" colspan="17">${message}</td></tr>`;
  }
  return rows.map(driverDataTableRow).join("");
}
function detailsContent() {
  const events = sourceData.events || [];
  const allRows = allDriverDataRows();
  const rows = filteredDriverDataRows();
  const lead = hero(titleMarkup("Driver Data"), "Corrected result identities · Penrose Cup race records", "Search a driver to see every matching race record, from their assigned Preliminary Placement Race through later competition rounds as results become available.");
  return `${lead}${driverDataFilterMarkup(allRows, events)}<section class="section-block leaderboard-section driver-data-section" id="statistics"><div class="section-heading"><div><p class="eyebrow" id="driver-data-count">${rows.length} race records</p><h2>Driver <em>data.</em></h2></div></div><details class="ranking-info detail-method-disclosure"><summary>Position, lap-time and penalty methods</summary><p class="detail-method">Every Main Race Results row is shown as a race entry. Finished, DNF, Retired and DSQ statuses count as raced; DNS is entered but not raced. A missing live telemetry record does not change participation. Race Points and status come from Race Director Results. Lap times use valid saved Results bests and show N/A when absent. Penalty values use the mapped result row: net game seconds plus steward seconds; appeal relief is applied once.</p></details><div class="leaderboard-card detail-table-card driver-data-card"><div class="table-scroll driver-data-scroll"><table class="race-breakdown-table driver-data-table" id="driver-data-table"><thead><tr>${driverDataTableHeader()}</tr></thead><tbody>${driverDataBody(rows)}</tbody></table></div></div></section>`;
}
function renderMainStats() {
  const target = $("#main-statistics");
  if (target) target.innerHTML = mainStatistics(selection());
  const summary = $("#stage-summary");
  if (summary) summary.innerHTML = summaryCards(scopeData.events, selection());
  const note = $("#active-filter-note");
  if (note) {
    const active = Object.entries(selectedFilters()).filter(([, value]) => value).map(([key]) => key);
    note.textContent = active.length ? `Active filters: ${active.join(", ")}.` : "Filters apply to cumulative statistics within this competition stage.";
  }
}
function renderDriverData() {
  const table = $("#driver-data-table");
  if (!table) return;
  const rows = filteredDriverDataRows();
  table.querySelector("tbody").innerHTML = driverDataBody(rows);
  const count = $("#driver-data-count");
  if (count) count.textContent = `${rows.length} matching race record${rows.length === 1 ? "" : "s"}`;
}
function updateDriverSortIndicators() {
  $$(".driver-sort").forEach((button) => {
    const key = button.dataset.driverSort;
    const column = DRIVER_DATA_COLUMNS.find((item) => item.key === key);
    const active = driverDataSort.key === key;
    const direction = active ? driverDataSort.direction : "none";
    const arrow = active ? (direction === "asc" ? "↑" : "↓") : "↕";
    button.classList.toggle("active", active);
    button.innerHTML = `${esc(column.label)} <span aria-hidden="true">${arrow}</span>`;
    button.closest("th")?.setAttribute("aria-sort", direction === "none" ? "none" : direction === "asc" ? "ascending" : "descending");
  });
}
function wireMainFilters() {
  filters = { event: $("#event-filter"), circuit: $("#circuit-filter"), team: $("#team-filter"), driver: $("#driver-filter") };
  Object.values(filters).forEach((control) => control?.addEventListener("change", renderMainStats));
  $("#reset-filters")?.addEventListener("click", () => { Object.values(filters).forEach((control) => { if (control) control.value = ""; }); renderMainStats(); });
}
function wireDriverDataControls() {
  const search = $("#driver-search");
  search?.addEventListener("input", () => { driverDataSearch = search.value; renderDriverData(); });
  $("#clear-driver-search")?.addEventListener("click", () => {
    driverDataSearch = "";
    if (search) search.value = "";
    search?.focus();
    renderDriverData();
  });
  const controls = {
    group: $("#driver-group-filter"), event: $("#driver-event-filter"),
    team: $("#driver-team-filter"), circuit: $("#driver-circuit-filter"),
  };
  Object.entries(controls).forEach(([key, control]) => control?.addEventListener("change", () => {
    driverDataFilters[key] = control.value || (key === "group" ? "All" : "");
    renderDriverData();
  }));
  $("#reset-driver-data")?.addEventListener("click", () => {
    driverDataSearch = "";
    driverDataFilters = { group: "All", event: "", team: "", circuit: "" };
    driverDataSort = { key: "driver", direction: "asc" };
    if (search) search.value = "";
    Object.values(controls).forEach((control) => { if (control) control.value = ""; });
    updateDriverSortIndicators();
    renderDriverData();
  });
  $$(".driver-sort").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.driverSort;
    if (driverDataSort.key === key) {
      driverDataSort.direction = driverDataSort.direction === "asc" ? "desc" : "asc";
    } else {
      driverDataSort = { key, direction: sortDirectionFor(key) };
    }
    updateDriverSortIndicators();
    renderDriverData();
  }));
}
function loadStatistics() {
  const dataUrl = new URL(DATA_URL, document.baseURI).href;
  return fetch(dataUrl, { cache: "no-store", headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } }).then(async (response) => {
    if (!response.ok) throw new Error(`Statistics request failed: GET ${dataUrl} returned HTTP ${response.status} ${response.statusText || ""}`.trim());
    const contentType = response.headers?.get("content-type") || "";
    const body = await response.text();
    if (contentType && !/\bjson\b/i.test(contentType)) {
      throw new Error(`Statistics request returned ${contentType} instead of JSON from ${dataUrl}. Response starts: ${body.slice(0, 100).replace(/\s+/g, " ")}`);
    }
    try {
      return JSON.parse(body);
    } catch (error) {
      throw new Error(`Statistics response from ${dataUrl} is not valid JSON: ${error.message}`);
    }
  }).then((json) => {
    if (!json || !Array.isArray(json.events) || !Array.isArray(json.drivers) || !json.groupStage?.groups) {
      throw new Error(`Statistics JSON from ${dataUrl} is missing required dashboard data (events, drivers or group standings).`);
    }
    if (!window.PenroseCore || typeof window.PenroseCore.qualificationBoundary !== "function") {
      throw new Error("Dashboard core script is missing or outdated: qualificationBoundary() is unavailable. Reload the page to fetch the current scripts.");
    }
    return json;
  });
}
function renderFromStatistics(json) {
  sourceData = json;
  baseShell();
  if (page === "home") {
    document.title = "Penrose Cup · Home";
    $("#page-content").innerHTML = homePageContent();
  } else if (page === "details") {
    document.title = "Driver Data · Penrose Cup Statistics";
    $("#page-content").innerHTML = detailsContent();
    wireDriverDataControls();
    updateDriverSortIndicators();
  } else {
    const savedFilters = selectedFilters();
    filters = {};
    const pageTitle = SCOPE_INFO[scope]?.title || "Penrose Cup";
    document.title = `${pageTitle} · Penrose Cup Statistics`;
    $("#page-content").innerHTML = mainPageContent();
    wireMainFilters();
    for (const [key, value] of Object.entries(savedFilters)) {
      const control = filters[key];
      if (control && [...control.options].some((option) => option.value === value)) control.value = value;
    }
    renderMainStats();
  }
}
async function refreshStatistics() {
  try {
    const json = await loadStatistics();
    renderFromStatistics(json);
  } catch (error) {
    console.error("Penrose Cup statistics refresh failed; keeping the last rendered data.", error);
    if (!sourceData) {
      const message = error instanceof Error ? error.message : String(error);
      const target = $("#page-content");
      if (target) target.innerHTML = `<p class="empty-state load-error" role="alert"><strong>Penrose Cup page could not load.</strong><br>${esc(message)}</p>`;
    }
  }
}
function start() {
  // Statistics refresh only when the page is loaded after an organiser-requested update.
  wireStandingsTooltips();
  if ("BroadcastChannel" in window) {
    const approvalUpdates = new BroadcastChannel("penrose-local-standings");
    approvalUpdates.addEventListener("message", (event) => {
      if (event.data?.type === "compliance-standings-updated") void refreshStatistics();
    });
  }
  void refreshStatistics();
}
start();
