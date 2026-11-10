(() => {
  function eventsForScope(data, scope) {
    const groupStage = (event) => event.stage === "Group A Pot" || event.stage === "Group B Pot";
    if (scope === "preliminary") return data.events.filter((event) => event.stage === "Placement Race");
    if (scope === "group-a") return data.events.filter((event) => event.stage === "Placement Race" || event.stage === "Group A Pot" || (event.calendarGroup === "Group A" && groupStage(event)));
    if (scope === "group-b") return data.events.filter((event) => event.stage === "Placement Race" || event.stage === "Group B Pot" || (event.calendarGroup === "Group B" && groupStage(event)));
    if (scope === "overall") return data.events.filter((event) => event.stage === "Placement Race" || groupStage(event));
    return [];
  }

  function select(data, selected) {
    const allowedEvents = new Set(data.events.filter((event) =>
      (!selected.stage || event.stage === selected.stage)
      && (!selected.event || event.key === selected.event)
      && (!selected.circuit || event.circuit === selected.circuit)
    ).map((event) => event.key));
    const groupMatches = (row) => !selected.group || selected.group === "Overall" || row.group === selected.group;
    const participations = data.participations.filter((row) => allowedEvents.has(row.eventKey)
      && (!selected.team || row.teamKey === selected.team)
      && (!selected.driver || row.driverKey === selected.driver)
      && groupMatches(row));
    return {
      selected,
      allowedEvents,
      participations,
      participationEvents: new Set(participations.map((row) => row.eventKey)),
    };
  }

  function leaderboard(data, selection, session, limit = 5) {
    const bestByDriver = new Map();
    for (const lap of data.bestLaps) {
      if (lap.session !== session || !selection.allowedEvents.has(lap.eventKey)) continue;
      if (selection.selected.team && lap.teamKey !== selection.selected.team) continue;
      if (selection.selected.driver && lap.driverKey !== selection.selected.driver) continue;
      if (selection.selected.group && selection.selected.group !== "Overall" && lap.group !== selection.selected.group) continue;
      const existing = bestByDriver.get(lap.driverKey);
      if (!existing || lap.milliseconds < existing.milliseconds) bestByDriver.set(lap.driverKey, lap);
    }
    return [...bestByDriver.values()]
      .sort((a, b) => a.milliseconds - b.milliseconds || a.driver.localeCompare(b.driver))
      .slice(0, limit);
  }

  function cumulative(data, selection, session) {
    const entries = (data.sessionEntries || []).filter((entry) => entry.session === session
      && selection.allowedEvents.has(entry.eventKey)
      && (session !== "Main Race" || entry.raceEntered !== true || entry.raceParticipated === true)
      && (!selection.selected.team || entry.teamKey === selection.selected.team)
      && (!selection.selected.driver || entry.driverKey === selection.selected.driver)
      && (!selection.selected.group || selection.selected.group === "Overall" || entry.group === selection.selected.group));
    const expected = new Map();
    const isUniversallyUnavailable = (entry) => session === "ShortQ"
      && data.events.find((event) => event.key === entry.eventKey)?.sessions
        ?.some((item) => item.session === session && (
          item.resultRowsWithValidBestLap !== undefined
            ? item.resultRowsWithValidBestLap === 0
            : item.lapHistoryState === "missing"
        ));
    const addExpected = (entry) => {
      if (!expected.has(entry.driverKey)) expected.set(entry.driverKey, { ...entry, sessions: new Map(), allSessions: new Map(), groups: new Set() });
      const expectedDriver = expected.get(entry.driverKey);
      expectedDriver.allSessions.set(entry.sessionKey, entry);
      if (!isUniversallyUnavailable(entry)) expectedDriver.sessions.set(entry.sessionKey, entry);
      if (entry.group) expectedDriver.groups.add(entry.group);
    };
    if (session === "ShortQ") {
      const qualifyingEntries = new Map(entries.map((entry) => [`${entry.driverKey}|${entry.eventKey}`, entry]));
      const raceEntries = (data.sessionEntries || []).filter((entry) => entry.session === "Main Race"
        && selection.allowedEvents.has(entry.eventKey)
        && (entry.raceEntered !== true || entry.raceParticipated === true)
        && (!selection.selected.team || entry.teamKey === selection.selected.team)
        && (!selection.selected.driver || entry.driverKey === selection.selected.driver)
        && (!selection.selected.group || selection.selected.group === "Overall" || entry.group === selection.selected.group));
      // Results participation defines the required path. A qualifying session
      // with no saved qualifying times for anyone is exempt for that event.
      // If a session exists with valid times for some drivers, missing driver
      // rows/times remain incomplete rather than silently shortening the path.
      if (raceEntries.length) {
        for (const raceEntry of raceEntries) {
          const event = data.events.find((item) => item.key === raceEntry.eventKey);
          const qualifyingSession = event?.sessions?.find((item) => item.session === "ShortQ");
          if (!qualifyingSession || qualifyingSession.resultRowsWithValidBestLap === 0) continue;
          const entry = qualifyingEntries.get(`${raceEntry.driverKey}|${raceEntry.eventKey}`)
            || { ...raceEntry, session: "ShortQ", sessionKey: `${raceEntry.eventKey}:ShortQ` };
          addExpected(entry);
        }
      } else {
        // Compatibility for isolated unit fixtures that contain only qualifying
        // rows. Extracted website data always has Main Race participation rows.
        for (const entry of entries) addExpected(entry);
      }
    } else {
      for (const entry of entries) addExpected(entry);
    }

    const bestByDriverSession = new Map();
    for (const lap of data.bestLaps) {
      if (lap.session !== session || !selection.allowedEvents.has(lap.eventKey)) continue;
      if (selection.selected.team && lap.teamKey !== selection.selected.team) continue;
      if (selection.selected.driver && lap.driverKey !== selection.selected.driver) continue;
      if (selection.selected.group && selection.selected.group !== "Overall" && lap.group !== selection.selected.group) continue;
      const key = `${lap.driverKey}|${lap.sessionKey}`;
      const old = bestByDriverSession.get(key);
      if (!old || lap.milliseconds < old.milliseconds) bestByDriverSession.set(key, lap);
    }

    const cohorts = new Map();
    for (const [driverKey, driver] of expected) {
      const eligible = [...driver.sessions.keys()].sort();
      const optionalKeys = [...driver.allSessions.keys()].filter((key) => !eligible.includes(key));
      const eligibleLapKeys = eligible.filter((key) => bestByDriverSession.has(`${driverKey}|${key}`));
      const optionalLapKeys = optionalKeys.filter((key) => bestByDriverSession.has(`${driverKey}|${key}`));
      const optionalLaps = optionalLapKeys.map((key) => bestByDriverSession.get(`${driverKey}|${key}`));
      const eligibleLaps = eligibleLapKeys.map((key) => bestByDriverSession.get(`${driverKey}|${key}`));
      const laps = [...eligibleLaps, ...optionalLaps];
      const cohortKey = eligible.join("\u001f");
      if (!cohorts.has(cohortKey)) cohorts.set(cohortKey, []);
      cohorts.get(cohortKey).push({
        driverKey, driver: driver.driver, team: driver.team, teamKey: driver.teamKey,
        group: driver.groups.size > 1 ? "Multiple groups" : (driver.group || "Unassigned"), eligibleSessions: eligible,
        allSessions: [...driver.allSessions.keys()].sort(),
        countedSessionKeys: [...eligibleLapKeys, ...optionalLapKeys].sort(),
        sessionCount: eligible.length, sessionsCounted: eligibleLaps.length,
        optionalSessionsCounted: optionalLaps.length,
        missingSessions: eligible.length - eligibleLaps.length,
        totalMilliseconds: laps.reduce((sum, lap) => sum + lap.milliseconds, 0),
        sources: [...new Set(laps.map((lap) => lap.source || "lap-history"))],
      });
    }

    const rankedCohorts = [];
    const partialCohorts = [];
    for (const [sessionSet, rows] of cohorts) {
      const complete = rows.filter((row) => row.missingSessions === 0 && row.sessionsCounted + row.optionalSessionsCounted > 0)
        .sort((a, b) => a.totalMilliseconds - b.totalMilliseconds || a.driver.localeCompare(b.driver));
      const partial = rows.filter((row) => row.missingSessions > 0 || row.sessionsCounted + row.optionalSessionsCounted === 0)
        .sort((a, b) => a.driver.localeCompare(b.driver));
      if (complete.length >= 2) rankedCohorts.push({ sessionSet: sessionSet.split("\u001f"), rows: complete });
      else partial.push(...complete);
      if (partial.length) partialCohorts.push({ sessionSet: sessionSet.split("\u001f"), rows: partial });
    }
    return { rankedCohorts, partialCohorts };
  }

  function comparableCumulative(data, selection, session) {
    const cumulativeResult = cumulative(data, selection, session);
    const rows = [...cumulativeResult.rankedCohorts, ...cumulativeResult.partialCohorts]
      .flatMap((cohort) => cohort.rows);
    const coverageGroups = new Map();
    for (const row of rows) {
      const frequencies = new Map();
      const eventKeys = row.countedSessionKeys.map((sessionKey) => {
        const separator = sessionKey.lastIndexOf(":");
        const eventKey = separator < 0 ? sessionKey : sessionKey.slice(0, separator);
        const event = data.events.find((item) => item.key === eventKey);
        const circuit = event?.circuit || "Unknown circuit";
        frequencies.set(circuit, (frequencies.get(circuit) || 0) + 1);
        return eventKey;
      });
      const circuitSet = [...frequencies.entries()].sort(([a], [b]) => a.localeCompare(b));
      const comparisonSessionCount = row.countedSessionKeys.length;
      const key = JSON.stringify([comparisonSessionCount, circuitSet]);
      if (!coverageGroups.has(key)) coverageGroups.set(key, {
        sessionCount: comparisonSessionCount, circuitSet, eventKeys: new Set(), rows: [], incompleteCount: 0,
      });
      const group = coverageGroups.get(key);
      eventKeys.forEach((eventKey) => group.eventKeys.add(eventKey));
      if (row.missingSessions === 0 && row.sessionsCounted + row.optionalSessionsCounted > 0) group.rows.push(row);
      else group.incompleteCount += 1;
    }
    const candidates = [...coverageGroups.values()]
      .filter((group) => group.rows.length >= 2)
      .map((group) => ({
        ...group,
        eventKeys: [...group.eventKeys].sort(),
        rows: group.rows.sort((a, b) => a.totalMilliseconds - b.totalMilliseconds || a.driver.localeCompare(b.driver)),
      }))
      .sort((a, b) => b.sessionCount - a.sessionCount || b.rows.length - a.rows.length
        || JSON.stringify(a.circuitSet).localeCompare(JSON.stringify(b.circuitSet)));
    if (!candidates.length) return null;
    const selected = candidates[0];
    const completeCount = rows.filter((row) => row.missingSessions === 0 && row.sessionsCounted + row.optionalSessionsCounted > 0).length;
    const incompleteCount = [...coverageGroups.values()].reduce((sum, group) => sum + group.incompleteCount, 0);
    return { ...selected, incompleteCount, excludedCoverageCount: completeCount - selected.rows.length };
  }

  function raceBreakdown(data, events, groupFilter = "") {
    const allowedEvents = new Set(events.map((event) => event.key));
    const rowsByDriverEvent = new Map();
    for (const entry of (data.sessionEntries || [])) {
      if (!allowedEvents.has(entry.eventKey)) continue;
      if (groupFilter && entry.group !== groupFilter) continue;
      const key = `${entry.driverKey}|${entry.eventKey}`;
      if (!rowsByDriverEvent.has(key)) rowsByDriverEvent.set(key, {
        driverKey: entry.driverKey, driver: entry.driver, team: entry.team, teamKey: entry.teamKey,
        group: entry.group, eventKey: entry.eventKey, event: entry.event, circuit: entry.circuit,
        date: entry.date, qualifyingLap: null, raceLap: null, startingGridPosition: null,
        finishingPosition: null, positionsGained: null, raceEntered: false,
        raceParticipated: null, raceParticipationState: "not-applicable", raceStatus: null,
        racePoints: null, raceLaps: null,
      });
      if (entry.session === "Main Race") {
        const row = rowsByDriverEvent.get(key);
        row.raceEntered = entry.raceEntered !== false;
        row.raceParticipated = entry.raceParticipated === undefined ? true : entry.raceParticipated;
        row.raceParticipationState = entry.raceParticipationState || (row.raceParticipated ? "participated" : "unverified");
        row.raceStatus = entry.raceStatus ?? null;
        row.racePoints = entry.racePoints ?? null;
        row.raceLaps = entry.raceLaps ?? null;
        row.startingGridPosition = entry.gridPosition ?? null;
        row.finishingPosition = entry.finishPosition ?? null;
        row.positionsGained = entry.positionsGained ?? null;
      }
    }
    const bestByDriverEventRole = new Map();
    for (const lap of data.bestLaps) {
      if (!allowedEvents.has(lap.eventKey) || (groupFilter && lap.group !== groupFilter)) continue;
      const key = `${lap.driverKey}|${lap.eventKey}`;
      if (!bestByDriverEventRole.has(key)) bestByDriverEventRole.set(key, {});
      const current = bestByDriverEventRole.get(key)[lap.session];
      if (!current || lap.milliseconds < current.milliseconds) bestByDriverEventRole.get(key)[lap.session] = lap;
    }
    const totals = new Map();
    for (const entry of (data.sessionEntries || [])) {
      if (!allowedEvents.has(entry.eventKey) || (groupFilter && entry.group !== groupFilter)) continue;
      const key = entry.driverKey;
      if (!totals.has(key)) totals.set(key, {
        qualifyingExpected: new Set(), qualifyingExempt: new Set(), raceEntered: new Set(), raceExpected: new Set(), qualifyingTimes: new Map(), raceTimes: new Map(),
      });
      const total = totals.get(key);
      if (entry.session === "Main Race") {
        total.raceEntered.add(entry.sessionKey);
        if (entry.raceEntered === true && entry.raceParticipated !== true) continue;
      }
      const expected = entry.session === "ShortQ" ? total.qualifyingExpected : total.raceExpected;
      const unavailableQualifying = entry.session === "ShortQ"
        && data.events.find((event) => event.key === entry.eventKey)?.sessions
          ?.some((item) => item.session === "ShortQ" && (
            item.resultRowsWithValidBestLap !== undefined
              ? item.resultRowsWithValidBestLap === 0
              : item.lapHistoryState === "missing"
          ));
      if (!unavailableQualifying) expected.add(entry.sessionKey);
      else total.qualifyingExempt.add(entry.sessionKey);
    }
    for (const [key, row] of rowsByDriverEvent) {
      const best = bestByDriverEventRole.get(key) || {};
      if (best.ShortQ) row.qualifyingLap = best.ShortQ;
      if (best["Main Race"]) row.raceLap = best["Main Race"];
      const total = totals.get(row.driverKey);
      if (row.qualifyingLap) total.qualifyingTimes.set(`${row.eventKey}:ShortQ`, row.qualifyingLap.milliseconds);
      if (row.raceLap) total.raceTimes.set(`${row.eventKey}:Main Race`, row.raceLap.milliseconds);
    }
    const penaltyByDriverEvent = new Map((data.penaltyEntries || []).map((entry) => [`${entry.driverKey}|${entry.eventKey}`, entry]));
    return [...rowsByDriverEvent.values()].map((row) => {
      const total = totals.get(row.driverKey);
      const penalty = penaltyByDriverEvent.get(`${row.driverKey}|${row.eventKey}`);
      return {
        ...row,
        penaltyAvailable: Boolean(penalty?.available),
        gamePenaltySeconds: penalty?.available ? penalty.gameSeconds - penalty.appealReliefSeconds : null,
        stewardPenaltySeconds: penalty?.available ? penalty.stewardSeconds : null,
        combinedPenaltySeconds: penalty?.available ? penalty.totalSeconds : null,
        lap1Position: null,
        positionsGained: row.positionsGained,
        qualifyingTotal: [...total.qualifyingTimes.values()].reduce((sum, value) => sum + value, 0),
        qualifyingCount: total.qualifyingTimes.size,
        qualifyingExpected: total.qualifyingExpected.size,
        qualifyingExempt: total.qualifyingExempt.size,
        raceTotal: [...total.raceTimes.values()].reduce((sum, value) => sum + value, 0),
        raceCount: total.raceTimes.size,
        racesEntered: total.raceEntered.size,
        racesParticipated: total.raceExpected.size,
        raceTimesRecorded: total.raceTimes.size,
        raceExpected: total.raceExpected.size,
      };
    }).sort((a, b) => a.date.localeCompare(b.date) || a.event.localeCompare(b.event) || a.driver.localeCompare(b.driver));
  }

  function positionsGained(data, selection, limit = 5) {
    const expected = new Map();
    for (const row of (data.sessionEntries || [])) {
      if (row.session !== "Main Race" || !selection.allowedEvents.has(row.eventKey)) continue;
      if (selection.selected.team && row.teamKey !== selection.selected.team) continue;
      if (selection.selected.driver && row.driverKey !== selection.selected.driver) continue;
      if (selection.selected.group && selection.selected.group !== "Overall" && row.group !== selection.selected.group) continue;
      if (!expected.has(row.driverKey)) expected.set(row.driverKey, { ...row, sessions: new Map() });
      expected.get(row.driverKey).sessions.set(row.eventKey, row);
    }
    const byKey = new Map();
    const ambiguous = new Set();
    for (const entry of (data.lap1Entries || [])) {
      if (!selection.allowedEvents.has(entry.eventKey)) continue;
      if (selection.selected.team && entry.teamKey !== selection.selected.team) continue;
      if (selection.selected.driver && entry.driverKey !== selection.selected.driver) continue;
      if (selection.selected.group && selection.selected.group !== "Overall" && entry.group !== selection.selected.group) continue;
      const key = `${entry.driverKey}|${entry.eventKey}`;
      if (byKey.has(key)) ambiguous.add(key);
      else byKey.set(key, entry);
    }
    const bestByDriver = new Map();
    let withoutAnyVerifiedLap1 = 0;
    for (const [driverKey, info] of expected) {
      const entries = [...info.sessions.keys()].map((eventKey) => ({ eventKey, entry: byKey.get(`${driverKey}|${eventKey}`) }))
        .filter(({ eventKey, entry }) => entry && entry.available && Number.isFinite(entry.positionsGained)
          && !ambiguous.has(`${driverKey}|${eventKey}`));
      if (!entries.length) { withoutAnyVerifiedLap1 += 1; continue; }
      entries.sort((a, b) => b.entry.positionsGained - a.entry.positionsGained
        || a.entry.date.localeCompare(b.entry.date) || a.entry.event.localeCompare(b.entry.event));
      const best = entries[0].entry;
      bestByDriver.set(driverKey, { ...info, bestPositionsGained: best.positionsGained,
        bestEvent: best.event, bestEventKey: best.eventKey, bestCircuit: best.circuit,
        bestDate: best.date, bestGridPosition: best.gridPosition, bestLap1Position: best.lap1Position,
        verifiedRaceCount: entries.length });
    }
    const rows = [...bestByDriver.values()].sort((a, b) => b.bestPositionsGained - a.bestPositionsGained || a.driver.localeCompare(b.driver));
    if (!rows.length) return null;
    const topTieCount = rows.filter((row) => row.bestPositionsGained === rows[0].bestPositionsGained).length;
    return { rows: rows.slice(0, limit), eligibleCount: rows.length, withoutAnyVerifiedLap1,
      topTieCount, verifiedRaceCount: [...new Set(rows.map((row) => row.verifiedRaceCount))] };
  }

  function teams(data, selection) {
    const driversByTeam = new Map();
    for (const row of selection.participations) {
      if (!driversByTeam.has(row.teamKey)) driversByTeam.set(row.teamKey, new Set());
      driversByTeam.get(row.teamKey).add(row.driverKey);
    }
    return data.teams.filter((team) => driversByTeam.has(team.key))
      .map((team) => ({ ...team, filteredDriverCount: driversByTeam.get(team.key).size }))
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  }

  function qualificationBoundary(standings) {
    const stage = String(standings.competitionStage || standings.stage || "Group Stage").toLowerCase();
    const isGroupStage = stage.includes("group") || (!stage.includes("knockout") && !stage.includes("semi") && !stage.includes("final"));
    const cutoff = stage.includes("semi") ? 5 : stage.includes("knockout") ? 8 : (standings.qualificationCutoff || standings.knockoutCutoff || 10);
    const rows = standings.teams || [];
    const ranked = standings.ranked ?? (rows.length > 0 && rows.every((row) => row.totalPoints != null && Number.isFinite(Number(row.totalPoints))));
    const races = standings.races || [];
    const race1 = races.find((race) => race.raceNumber === 1);
    const race2 = races.find((race) => race.raceNumber === 2);
    // Group standings become useful for a provisional drop zone as soon as a
    // complete Race 1 table can be ranked. Race 2 then uses combined totals.
    const boundaryReached = isGroupStage ? race1?.captured === true : (standings.resultsCaptured ?? ranked);
    const tie = ranked && rows.length > cutoff
      && rows[cutoff - 1].totalPoints != null
      && rows[cutoff].totalPoints != null
      && Number(rows[cutoff - 1].totalPoints) === Number(rows[cutoff].totalPoints);
    const confirmed = !tie && (standings.eliminationConfirmed === true || standings.qualificationConfirmed === true);
    const show = Boolean(ranked && boundaryReached && rows.length > cutoff);
    // If the cutoff is tied, keep tied teams together and put the visual line
    // after the tied block. The warning remains explicit that progression is
    // undecided; no tie-break is invented.
    let lineAfter = cutoff;
    if (tie) {
      const cutoffPoints = Number(rows[cutoff - 1].totalPoints);
      for (let index = cutoff; index < rows.length; index += 1) {
        if (Number(rows[index].totalPoints) !== cutoffPoints) break;
        lineAfter = index + 1;
      }
    }
    let label = "";
    if (show) {
      label = `${confirmed ? "QUALIFICATION LINE" : "PROVISIONAL QUALIFICATION LINE"} — TOP ${cutoff} PROGRESS`;
      if (tie) label += " · TIE AT CUTOFF — QUALIFICATION UNDECIDED";
    }
    const dropZoneLabel = show && isGroupStage && !confirmed
      ? (tie
        ? "PROVISIONAL DROP ZONE — CUTOFF TIE UNRESOLVED"
        : `PROVISIONAL DROP ZONE — ${rows.length - cutoff} TEAMS AT RISK`)
      : "";
    const qualifyingZoneLabel = show && isGroupStage
      ? `CURRENTLY IN QUALIFYING POSITIONS${tie ? " — CUTOFF TIE UNRESOLVED" : ""}`
      : "";
    return { cutoff, lineAfter: show ? lineAfter : null, tie, confirmed: show && confirmed, label, dropZoneLabel, qualifyingZoneLabel, isGroupStage };
  }

  function eliminationNotice(group, stage = "Group Stage") {
    const stageKey = String(stage || "Group Stage").toLowerCase();
    const label = String(group || "Group A").toUpperCase();
    if (stageKey.includes("semi")) return `${label} — 3 TEAMS TO BE ELIMINATED`;
    if (stageKey.includes("knockout")) return `${label} — 2 TEAMS TO BE ELIMINATED`;
    if (stageKey.includes("final")) return `${label} — 5 TEAMS IN THE CHAMPIONSHIP RACE`;
    return `${label} — ${label === "GROUP A" ? 6 : 9} TEAMS AT RISK`;
  }

  function raceTimeDisplay(value, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
    if (!value) return null;
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) return null;
    const format = (zone, options) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, ...options });
    const clockOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
    const dateOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
    const keyOptions = { year: "numeric", month: "2-digit", day: "2-digit" };
    let localZone = timeZone || "Europe/London";
    try {
      const ukTime = format("Europe/London", clockOptions).format(instant);
      const localTime = format(localZone, clockOptions).format(instant);
      const ukDateKey = format("Europe/London", keyOptions).format(instant);
      const localDateKey = format(localZone, keyOptions).format(instant);
      return {
        ukTime,
        localTime,
        localDate: format(localZone, dateOptions).format(instant),
        sameAsUK: ukTime === localTime && ukDateKey === localDateKey,
        dateDiffers: ukDateKey !== localDateKey,
        timeZone: localZone,
      };
    } catch (_error) {
      localZone = "Europe/London";
      const ukTime = format("Europe/London", clockOptions).format(instant);
      return {
        ukTime, localTime: ukTime,
        localDate: format(localZone, dateOptions).format(instant),
        sameAsUK: true, dateDiffers: false, timeZone: localZone,
      };
    }
  }

  globalThis.PenroseCore = { eventsForScope, select, leaderboard, cumulative, comparableCumulative, raceBreakdown, positionsGained, teams, qualificationBoundary, eliminationNotice, raceTimeDisplay };
})();
