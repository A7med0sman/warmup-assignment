const fs = require("fs");

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/** Convert "hh:mm:ss am/pm" → total seconds since midnight */
function timeToSeconds(timeStr) {
  timeStr = timeStr.trim().toLowerCase();
  const parts = timeStr.split(" ");
  const period = parts[1]; // "am" or "pm"
  const [hStr, mStr, sStr] = parts[0].split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const s = parseInt(sStr, 10);

  if (period === "am") {
    if (h === 12) h = 0; // 12:xx am → 0 hours
  } else {
    if (h !== 12) h += 12; // pm: add 12 except for 12 pm
  }

  return h * 3600 + m * 60 + s;
}

/** Convert "h:mm:ss" duration string → total seconds */
function durationToSeconds(durStr) {
  durStr = durStr.trim();
  const [hStr, mStr, sStr] = durStr.split(":");
  return parseInt(hStr, 10) * 3600 + parseInt(mStr, 10) * 60 + parseInt(sStr, 10);
}

/** Convert total seconds → "h:mm:ss" duration string */
function secondsToDuration(totalSeconds) {
  totalSeconds = Math.abs(totalSeconds);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${h}:${mm}:${ss}`;
}

/** Convert total seconds → "hhh:mm:ss" (3-digit hour for totals) */
function secondsToLongDuration(totalSeconds) {
  totalSeconds = Math.abs(totalSeconds);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${h}:${mm}:${ss}`;
}

/** Parse a line from shifts.txt into an object */
function parseShiftLine(line) {
  const cols = line.split(",");
  if (cols.length < 10) return null;
  return {
    driverID: cols[0].trim(),
    driverName: cols[1].trim(),
    date: cols[2].trim(),
    startTime: cols[3].trim(),
    endTime: cols[4].trim(),
    shiftDuration: cols[5].trim(),
    idleTime: cols[6].trim(),
    activeTime: cols[7].trim(),
    metQuota: cols[8].trim() === "true",
    hasBonus: cols[9].trim() === "true",
  };
}

/** Serialize a shift object back to a CSV line */
function shiftToLine(obj) {
  return [
    obj.driverID,
    obj.driverName,
    obj.date,
    obj.startTime,
    obj.endTime,
    obj.shiftDuration,
    obj.idleTime,
    obj.activeTime,
    obj.metQuota,
    obj.hasBonus,
  ].join(",");
}

/** Parse a line from driverRates.txt into an object */
function parseRateLine(line) {
  const cols = line.split(",");
  if (cols.length < 4) return null;
  return {
    driverID: cols[0].trim(),
    dayOff: cols[1].trim(),
    basePay: parseInt(cols[2].trim(), 10),
    tier: parseInt(cols[3].trim(), 10),
  };
}

/** Read all non-empty lines from a file */
function readLines(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return content.split("\n").filter((l) => l.trim() !== "");
}

/** Day name from a yyyy-mm-dd date string */
function getDayName(dateStr) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const d = new Date(dateStr);
  return days[d.getUTCDay()];
}

// ─────────────────────────────────────────────
// FUNCTION 1: getShiftDuration
// ─────────────────────────────────────────────
function getShiftDuration(startTime, endTime) {
  const startSec = timeToSeconds(startTime);
  const endSec = timeToSeconds(endTime);
  const diff = endSec - startSec;
  return secondsToDuration(diff);
}

// ─────────────────────────────────────────────
// FUNCTION 2: getIdleTime
// ─────────────────────────────────────────────
function getIdleTime(startTime, endTime) {
  const startSec = timeToSeconds(startTime);
  const endSec = timeToSeconds(endTime);

  // Delivery hours: 8:00 AM (28800s) to 10:00 PM (79200s)
  const deliveryStart = 8 * 3600;  // 28800
  const deliveryEnd = 22 * 3600;   // 79200

  let idleSec = 0;

  // Idle before 8 AM
  if (startSec < deliveryStart) {
    const idleBefore = Math.min(deliveryStart, endSec) - startSec;
    if (idleBefore > 0) idleSec += idleBefore;
  }

  // Idle after 10 PM
  if (endSec > deliveryEnd) {
    const idleAfter = endSec - Math.max(deliveryEnd, startSec);
    if (idleAfter > 0) idleSec += idleAfter;
  }

  return secondsToDuration(idleSec);
}

// ─────────────────────────────────────────────
// FUNCTION 3: getActiveTime
// ─────────────────────────────────────────────
function getActiveTime(shiftDuration, idleTime) {
  const shiftSec = durationToSeconds(shiftDuration);
  const idleSec = durationToSeconds(idleTime);
  return secondsToDuration(shiftSec - idleSec);
}

// ─────────────────────────────────────────────
// FUNCTION 4: metQuota
// ─────────────────────────────────────────────
function metQuota(date, activeTime) {
  const activeSec = durationToSeconds(activeTime);

  // Check if date is within Eid al-Fitr period: Apr 10–30, 2025
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1-based
  const day = d.getUTCDate();

  let quotaSec;
  if (year === 2025 && month === 4 && day >= 10 && day <= 30) {
    quotaSec = 6 * 3600; // 6 hours
  } else {
    quotaSec = 8 * 3600 + 24 * 60; // 8h 24m
  }

  return activeSec >= quotaSec;
}

// ─────────────────────────────────────────────
// FUNCTION 5: addShiftRecord
// ─────────────────────────────────────────────
function addShiftRecord(textFile, shiftObj) {
  const lines = readLines(textFile);

  // 1. Check for duplicate (same driverID + date)
  for (const line of lines) {
    const record = parseShiftLine(line);
    if (record && record.driverID === shiftObj.driverID && record.date === shiftObj.date) {
      return {};
    }
  }

  // 2. Calculate derived fields
  const shiftDuration = getShiftDuration(shiftObj.startTime, shiftObj.endTime);
  const idleTime = getIdleTime(shiftObj.startTime, shiftObj.endTime);
  const activeTime = getActiveTime(shiftDuration, idleTime);
  const quota = metQuota(shiftObj.date, activeTime);

  const newRecord = {
    driverID: shiftObj.driverID,
    driverName: shiftObj.driverName,
    date: shiftObj.date,
    startTime: shiftObj.startTime,
    endTime: shiftObj.endTime,
    shiftDuration: shiftDuration,
    idleTime: idleTime,
    activeTime: activeTime,
    metQuota: quota,
    hasBonus: false,
  };

  const newLine = shiftToLine(newRecord);

  // 3. Find insertion point: after the last record of this driverID,
  //    or at the end if driverID doesn't exist yet.
  let lastIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const record = parseShiftLine(lines[i]);
    if (record && record.driverID === shiftObj.driverID) {
      lastIndex = i;
    }
  }

  if (lastIndex === -1) {
    // driverID not present → append at end
    lines.push(newLine);
  } else {
    // Insert after the last record of this driverID
    lines.splice(lastIndex + 1, 0, newLine);
  }

  fs.writeFileSync(textFile, lines.join("\n") + "\n", "utf8");

  return newRecord;
}

// ─────────────────────────────────────────────
// FUNCTION 6: setBonus
// ─────────────────────────────────────────────
function setBonus(textFile, driverID, date, newValue) {
  const lines = readLines(textFile);

  for (let i = 0; i < lines.length; i++) {
    const record = parseShiftLine(lines[i]);
    if (record && record.driverID === driverID && record.date === date) {
      record.hasBonus = newValue;
      lines[i] = shiftToLine(record);
      break;
    }
  }

  fs.writeFileSync(textFile, lines.join("\n") + "\n", "utf8");
}

// ─────────────────────────────────────────────
// FUNCTION 7: countBonusPerMonth
// ─────────────────────────────────────────────
function countBonusPerMonth(textFile, driverID, month) {
  const lines = readLines(textFile);
  const targetMonth = parseInt(month, 10); // handle "4" or "04"

  let driverFound = false;
  let count = 0;

  for (const line of lines) {
    const record = parseShiftLine(line);
    if (!record || record.driverID !== driverID) continue;
    driverFound = true;

    const recordMonth = parseInt(record.date.split("-")[1], 10);
    if (recordMonth === targetMonth && record.hasBonus === true) {
      count++;
    }
  }

  return driverFound ? count : -1;
}

// ─────────────────────────────────────────────
// FUNCTION 8: getTotalActiveHoursPerMonth
// ─────────────────────────────────────────────
function getTotalActiveHoursPerMonth(textFile, driverID, month) {
  const lines = readLines(textFile);
  const targetMonth = parseInt(month, 10);
  let totalSec = 0;

  for (const line of lines) {
    const record = parseShiftLine(line);
    if (!record || record.driverID !== driverID) continue;

    const recordMonth = parseInt(record.date.split("-")[1], 10);
    if (recordMonth === targetMonth) {
      totalSec += durationToSeconds(record.activeTime);
    }
  }

  return secondsToLongDuration(totalSec);
}

// ─────────────────────────────────────────────
// FUNCTION 9: getRequiredHoursPerMonth
// ─────────────────────────────────────────────
function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
  const shiftLines = readLines(textFile);
  const rateLines = readLines(rateFile);

  // Get driver's day off
  let dayOff = null;
  for (const line of rateLines) {
    const rate = parseRateLine(line);
    if (rate && rate.driverID === driverID) {
      dayOff = rate.dayOff;
      break;
    }
  }

  const targetMonth = parseInt(month, 10);
  let totalRequiredSec = 0;

  for (const line of shiftLines) {
    const record = parseShiftLine(line);
    if (!record || record.driverID !== driverID) continue;

    const recordMonth = parseInt(record.date.split("-")[1], 10);
    if (recordMonth !== targetMonth) continue;

    // Skip days that are the driver's day off
    const dayName = getDayName(record.date);
    if (dayOff && dayName === dayOff) continue;

    // Check Eid period for this date
    const d = new Date(record.date);
    const year = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const day = d.getUTCDate();

    let dailyQuotaSec;
    if (year === 2025 && mo === 4 && day >= 10 && day <= 30) {
      dailyQuotaSec = 6 * 3600;
    } else {
      dailyQuotaSec = 8 * 3600 + 24 * 60;
    }

    totalRequiredSec += dailyQuotaSec;
  }

  // Subtract 2 hours per bonus
  totalRequiredSec -= bonusCount * 2 * 3600;
  if (totalRequiredSec < 0) totalRequiredSec = 0;

  return secondsToLongDuration(totalRequiredSec);
}

// ─────────────────────────────────────────────
// FUNCTION 10: getNetPay
// ─────────────────────────────────────────────
function getNetPay(driverID, actualHours, requiredHours, rateFile) {
  const rateLines = readLines(rateFile);

  let basePay = 0;
  let tier = 0;
  for (const line of rateLines) {
    const rate = parseRateLine(line);
    if (rate && rate.driverID === driverID) {
      basePay = rate.basePay;
      tier = rate.tier;
      break;
    }
  }

  // Allowed missing hours per tier (no deduction)
  const allowedMissingHours = { 1: 50, 2: 20, 3: 10, 4: 3 };
  const allowed = (allowedMissingHours[tier] || 0) * 3600; // convert to seconds

  const actualSec = durationToSeconds(actualHours);
  const requiredSec = durationToSeconds(requiredHours);

  // If actual >= required → no deduction
  if (actualSec >= requiredSec) {
    return basePay;
  }

  const missingSec = requiredSec - actualSec;

  // Subtract allowed buffer
  const billableSec = missingSec - allowed;
  if (billableSec <= 0) {
    return basePay; // within allowed missing hours
  }

  // Only full hours count
  const billableHours = Math.floor(billableSec / 3600);
  if (billableHours === 0) {
    return basePay;
  }

  const deductionRatePerHour = Math.floor(basePay / 185);
  const salaryDeduction = billableHours * deductionRatePerHour;
  const netPay = basePay - salaryDeduction;

  return netPay;
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────
module.exports = {
  getShiftDuration,
  getIdleTime,
  getActiveTime,
  metQuota,
  addShiftRecord,
  setBonus,
  countBonusPerMonth,
  getTotalActiveHoursPerMonth,
  getRequiredHoursPerMonth,
  getNetPay,
};
