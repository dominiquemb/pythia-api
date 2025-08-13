// 1. Import necessary packages
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch"); // Use node-fetch for making requests in Node.js
const axios = require("axios");
const mariadb = require("mariadb"); // Import the MariaDB package
const sweph = require("swisseph"); // Import Swiss Ephemeris for astrological calculations
const { DateTime } = require("luxon");
const cityTimezones = require("city-timezones");
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://dldezknthsmgskwvhqtk.supabase.co";
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SECRET_KEY);

// 2. Initialize the Express app
const app = express();
const PORT = process.env.PORT || 3002; // Use a port from .env or default to 3002

// 3. Middleware setup
app.use(cors()); // Enable Cross-Origin Resource Sharing for your React app
app.use(express.json()); // Enable the server to parse JSON request bodies

// 4. MariaDB Connection Pool
// Use the connection details provided to connect to your database.
// 4. MariaDB Connection Pool (Using Environment Variables)
const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  connectionLimit: 5,
  supportBigNumbers: true,
  insertIdAsNumber: true,
});

// --- Helper Functions ---

// A helper function to log key chart placements in a readable format
function logChartSummary(chart, title = "Chart Summary") {
  if (!chart) {
    console.log(`-- ${title}: Invalid chart data provided --`);
    return;
  }

  console.log(`\n--- ${title} ---`);

  // Log Angles (Ascendant & MC) if the chart has houses
  if (chart.houses && chart.houses.ascendant) {
    const asc = getZodiacSign(chart.houses.ascendant);
    const mc = getZodiacSign(chart.houses.mc);
    console.log(`Ascendant: ${asc.degrees.toFixed(2)}° ${asc.sign}`);
    console.log(`MC:        ${mc.degrees.toFixed(2)}° ${mc.sign}`);
    console.log(`---------------------------------`);
  }

  // Log all planets and bodies from the positions object
  if (chart.positions) {
    const planetNames = Object.keys(chart.positions);
    // Find the longest name for clean padding
    const longestName = Math.max(...planetNames.map((name) => name.length));

    for (const planetName of planetNames) {
      const planetData = chart.positions[planetName];
      if (
        !planetData ||
        typeof planetData.sign_degrees !== "number" ||
        !planetData.sign
      )
        continue;

      const paddedName = planetName.padEnd(longestName, " ");
      const degrees = planetData.sign_degrees.toFixed(2).padStart(5, " ");
      const sign = planetData.sign.padEnd(11, " ");

      // Only show house if it exists on the object
      const house = planetData.house
        ? `(H${String(planetData.house).padStart(2, " ")})`
        : "";

      console.log(`${paddedName}: ${degrees}° ${sign} ${house}`);
    }
  }

  console.log(`---------------------------------\n`);
}

/**
 * Determines the zodiac sign and degree within that sign from a celestial longitude.
 * @param {number} longitude - The celestial longitude in degrees (0-360).
 * @returns {{sign: string, degrees: number}} - The zodiac sign and the degree within it.
 */
const getZodiacSign = (longitude) => {
  const signs = [
    "Aries",
    "Taurus",
    "Gemini",
    "Cancer",
    "Leo",
    "Virgo",
    "Libra",
    "Scorpio",
    "Sagittarius",
    "Capricorn",
    "Aquarius",
    "Pisces",
  ];
  const signIndex = Math.floor(longitude / 30);
  const degreesInSign = longitude % 30;
  return {
    sign: signs[signIndex],
    degrees: degreesInSign,
  };
};

/**
 * Determines the house placement of a celestial body.
 * @param {number} longitude - The celestial longitude of the planet.
 * @param {Array<number>} houseCusps - An array of 12 house cusp longitudes.
 * @returns {number | null} - The house number (1-12) or null if not found.
 */
const getHousePlacement = (longitude, houseCusps) => {
  if (!houseCusps || houseCusps.length < 12) return null;
  for (let i = 0; i < 12; i++) {
    const cusp1 = houseCusps[i];
    const cusp2 = houseCusps[(i + 1) % 12]; // Next cusp, wraps around from 12 to 1
    if (cusp1 > cusp2) {
      // Handle the case where the house crosses the 0° Aries point
      if (longitude >= cusp1 || longitude < cusp2) return i + 1;
    } else {
      if (longitude >= cusp1 && longitude < cusp2) return i + 1;
    }
  }
  return null;
};

/**
 * Main helper function to perform all astrological calculations.
 * @param {number} year - The year of the event.
 * @param {number} month - The month of the event.
 * @param {number} day - The day of the event.
 * @param {string} time - The time of the event (e.g., "14:30").
 * @param {string} location - The location of the event.
 * @returns {Promise<object>} - A promise that resolves to the complete chart data object.
 * @throws {Error} - Throws an error if any part of the calculation fails.
 */
async function calculateChart(
  year,
  month,
  day,
  time,
  location,
  includeHouses = true, // ✅ New optional parameter
  houseSystem = "P" // Default house system
) {
  // --- 1. Geocoding and Timezone Conversion ---
  // This step is still needed to convert the local time to the correct Universal Time (UT),
  // as the timezone is derived from the location.
  const geocodingApiKey = process.env.GEOCODING_API_KEY;
  if (!geocodingApiKey) {
    throw new Error("GEOCODING_API_KEY not found on the server.");
  }

  const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    location
  )}&key=${geocodingApiKey}`;
  const geocodeResponse = await axios.get(geocodeUrl);
  const geoData = geocodeResponse.data;

  if (geoData.status !== "OK" || !geoData.results[0]) {
    throw new Error("Could not geocode the provided location.");
  }

  const { lat, lng } = geoData.results[0].geometry.location;
  const formattedLocation = geoData.results[0].formatted_address;

  const isoString = `${year}-${String(month).padStart(2, "0")}-${String(
    day
  ).padStart(2, "0")}T${time}`;
  const localTime = DateTime.fromISO(isoString);

  const timezoneUrl = `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${localTime.toSeconds()}&key=${geocodingApiKey}`;
  const timezoneResponse = await axios.get(timezoneUrl);
  const tzData = timezoneResponse.data;

  if (tzData.status !== "OK") {
    throw new Error("Could not determine the timezone for the location.");
  }

  const utcTime = DateTime.fromISO(isoString, {
    zone: tzData.timeZoneId,
  }).toUTC();
  if (!utcTime.isValid) {
    throw new Error(`Invalid date or time provided: ${utcTime.invalidReason}`);
  }

  // --- 2. Astrological Calculations using Swiss Ephemeris ---
  sweph.swe_set_ephe_path(__dirname + "/ephe");

  const julianDayUT = sweph.swe_julday(
    utcTime.year,
    utcTime.month,
    utcTime.day,
    utcTime.hour + utcTime.minute / 60 + utcTime.second / 3600,
    sweph.SE_GREG_CAL
  );

  const chartData = {
    meta: {
      date: utcTime.toFormat("yyyy-MM-dd HH:mm:ss 'UTC'"),
      location: formattedLocation,
      latitude: lat,
      longitude: lng,
      inputs: { year, month, day, time, location },
    },
    positions: {},
    houses: null, // Default to null
    aspects: [],
  };

  // --- 3. House Calculation (Now Conditional) ---
  if (includeHouses) {
    const housesResult = sweph.swe_houses(julianDayUT, lat, lng, houseSystem);
    if (housesResult.error) {
      throw new Error(`House calculation failed: ${housesResult.error}`);
    }
    chartData.houses = {
      system: houseSystem,
      ascendant: housesResult.asc,
      mc: housesResult.mc,
      cusps: housesResult.house.slice(0, 12),
    };
  }

  // --- 4. Planet Calculation ---
  const planets = {
    Sun: sweph.SE_SUN,
    Moon: sweph.SE_MOON,
    Mercury: sweph.SE_MERCURY,
    Venus: sweph.SE_VENUS,
    Mars: sweph.SE_MARS,
    Jupiter: sweph.SE_JUPITER,
    Saturn: sweph.SE_SATURN,
    Uranus: sweph.SE_URANUS,
    Neptune: sweph.SE_NEPTUNE,
    Pluto: sweph.SE_PLUTO,
    "North Node": sweph.SE_TRUE_NODE,
    Chiron: sweph.SE_CHIRON,
  };

  for (const [name, id] of Object.entries(planets)) {
    const result = sweph.swe_calc_ut(
      julianDayUT,
      id,
      sweph.SEFLG_SPEED | sweph.SEFLG_JPLEPH
    );
    if (result.error) {
      console.warn(`Swiss Ephemeris warning for ${name}:`, result.error);
      continue;
    }
    const signInfo = getZodiacSign(result.longitude);

    // Build the position data object
    const positionData = {
      longitude: result.longitude,
      latitude: result.latitude,
      speed: result.speed,
      sign: signInfo.sign,
      sign_degrees: signInfo.degrees,
    };

    // ✅ Conditionally add house placement
    if (includeHouses && chartData.houses) {
      positionData.house = getHousePlacement(
        result.longitude,
        chartData.houses.cusps
      );
    }

    chartData.positions[name] = positionData;
  }

  // --- 5. Aspect Calculation (Unaffected by houses) ---
  const aspectTypes = {
    conjunction: { angle: 0, orb: 8, color: "#4a4a4a" },
    opposition: { angle: 180, orb: 8, color: "#ff4d4d" },
    trine: { angle: 120, orb: 8, color: "#2b8a3e" },
    square: { angle: 90, orb: 8, color: "#e03131" },
    sextile: { angle: 60, orb: 6, color: "#1c7ed6" },
    quincunx: { angle: 150, orb: 3, color: "#f08c00" },
  };

  const planetNames = Object.keys(chartData.positions);
  for (let i = 0; i < planetNames.length; i++) {
    for (let j = i + 1; j < planetNames.length; j++) {
      const p1 = chartData.positions[planetNames[i]];
      const p2 = chartData.positions[planetNames[j]];
      if (!p1 || !p2) continue;
      let angle = Math.abs(p1.longitude - p2.longitude);
      if (angle > 180) angle = 360 - angle;
      for (const aspectName in aspectTypes) {
        const aspect = aspectTypes[aspectName];
        if (Math.abs(angle - aspect.angle) <= aspect.orb) {
          chartData.aspects.push({
            planet1: planetNames[i],
            planet2: planetNames[j],
            aspect: aspectName,
            orb: Math.abs(angle - aspect.angle),
            color: aspect.color,
          });
          break;
        }
      }
    }
  }

  // --- 6. Cleanup ---
  sweph.swe_close();

  return chartData;
}

async function recalculateAllChartsOnStartup() {
  console.log("🚀 Starting recalculation of all saved astro charts...");
  let conn;
  try {
    conn = await pool.getConnection();

    const queryResult = await conn.query(
      "SELECT event_id, event_data FROM astro_event_data"
    );

    let events = [];
    if (queryResult) {
      if (Array.isArray(queryResult)) {
        events = queryResult;
      } else if (typeof queryResult === "object" && queryResult !== null) {
        events = [queryResult];
      }
    }

    if (events.length === 0) {
      console.log("No saved charts to recalculate. Startup complete.");
      if (conn) conn.release();
      return;
    }

    console.log(`Found ${events.length} charts to process.`);

    for (const event of events) {
      try {
        const eventId = event.event_id;
        let data;
        if (typeof event.event_data === "string") {
          data = JSON.parse(event.event_data);
        } else {
          data = event.event_data;
        }

        let inputs;
        if (data.meta && data.meta.inputs) {
          inputs = data.meta.inputs;
        } else if (data.meta && data.meta.date && data.meta.location) {
          console.log(
            `Event ID ${eventId} is old format, reconstructing inputs...`
          );

          const dateString = data.meta.date.replace(" UTC", "");
          const utcDate = DateTime.fromSQL(dateString, { zone: "utc" });

          if (utcDate.isValid) {
            inputs = {
              year: utcDate.year,
              month: utcDate.month,
              day: utcDate.day,
              time: utcDate.toFormat("HH:mm:ss"),
              location: data.meta.location,
            };

            // ✅ ADD THIS LOGGING to verify the reconstructed inputs
            console.log(`---> Reconstructed for Event ${eventId}:`, inputs);
          }
        }

        if (
          !inputs ||
          !inputs.year ||
          !inputs.month ||
          !inputs.day ||
          !inputs.time ||
          !inputs.location
        ) {
          console.warn(
            `Skipping event ID ${eventId}: Missing or invalid input data even after fallback.`
          );
          continue;
        }

        console.log(`Recalculating chart for event ID: ${eventId}...`);

        const recalculatedChartData = await calculateChart(
          inputs.year,
          inputs.month,
          inputs.day,
          inputs.time,
          inputs.location
        );

        const updateQuery =
          "UPDATE astro_event_data SET event_data = ? WHERE event_id = ?";
        await conn.query(updateQuery, [
          JSON.stringify(recalculatedChartData),
          eventId,
        ]);

        console.log(
          `✅ Successfully recalculated chart for event ID: ${eventId}`
        );
      } catch (recalcError) {
        console.error(
          `❌ Failed to recalculate chart for event ID ${event.event_id}:`,
          recalcError.message
        );
      }
    }

    console.log("✨ Chart recalculation process finished successfully.");
  } catch (err) {
    console.error(
      "A critical error occurred during the chart recalculation process:",
      err.message
    );
  } finally {
    if (conn) conn.release();
  }
}
app.put("/api/astro-event/:eventId", async (req, res) => {
  const { authorization } = req.headers;
  const { eventId } = req.params;
  const updatedFields = req.body;

  console.log(`--- Received Update for Event ID ${eventId} ---`);
  console.log(req.body);
  console.log("------------------------------------------");

  let conn;
  if (!authorization) {
    return res.status(400).json({
      response:
        "Missing JWT token in Authorization header. Please provide a valid JWT token",
    });
  }

  try {
    const verified = await supabase.auth.getUser(authorization);
    if (!verified?.data?.user) {
      return res.status(400).json({
        response: "Invalid JWT token",
      });
    }

    // ✅ CORRECTED: Security check now correctly gets the userId from the request body.
    if (verified.data.user.id !== updatedFields.userId) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You can only update your own events.",
      });
    }

    if (!eventId || isNaN(parseInt(eventId))) {
      return res
        .status(400)
        .json({ error: "A valid eventId must be provided." });
    }

    conn = await pool.getConnection();
    // ✅ CORRECTED: Use the same robust query and normalization logic
    const queryResult = await conn.query(
      "SELECT event_data, label FROM astro_event_data WHERE user_id = ? AND event_id = ?",
      [updatedFields.userId, eventId]
    );

    // Normalize the result to always be an array to handle MariaDB's behavior
    const rows = queryResult
      ? Array.isArray(queryResult)
        ? queryResult
        : [queryResult]
      : [];

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ error: `Event with ID ${eventId} not found.` });
    }

    const existingData = JSON.parse(rows[0].event_data);
    const existingLabel = rows[0].label;

    const newInputs = { ...existingData.meta.inputs, ...updatedFields };
    const newLabel = updatedFields.label || existingLabel;

    const { year, month, day, time, location } = newInputs;
    if (!year || !month || !day || !time || !location) {
      return res.status(400).json({
        error: "Update would result in missing date, time, or location.",
      });
    }
    const recalculatedChartData = await calculateChart(
      year,
      month,
      day,
      time,
      location
    );

    const updateQuery = `
      UPDATE astro_event_data 
      SET label = ?, event_data = ? 
      WHERE event_id = ?;
    `;
    await conn.query(updateQuery, [
      newLabel,
      JSON.stringify(recalculatedChartData),
      eventId,
    ]);

    recalculatedChartData.event_id = parseInt(eventId);

    // ✅ ADDED: Human-readable log of the data being sent back to the client.
    logChartSummary(
      recalculatedChartData,
      `Updated Chart Sent for "${newLabel}"`
    );

    res.status(200).json(recalculatedChartData);
  } catch (err) {
    console.error(`PUT /api/astro-event Error:`, err.message);
    res.status(500).json({
      error: "An error occurred while updating the event.",
      details: err.message,
    });
  } finally {
    if (conn) conn.release();
  }
});

app.delete("/api/astro-event/:eventId", async (req, res) => {
  const { authorization } = req.headers;
  const { eventId } = req.params;

  let conn;
  if (!authorization) {
    return res.status(400).json({
      response:
        "Missing JWT token in Authorization header. Please provide a valid JWT token",
    });
  }

  const verified = await supabase.auth.getUser(authorization);
  if (!verified?.data?.user) {
    return res.status(400).json({
      response: "Invalid JWT token",
    });
  }

  // Security check: ensure the requesting user is the one they're asking for data about
  if (verified.data.user.id !== userId) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: You can only request your own data.",
    });
  }
  try {
    // --- Validation ---
    if (!eventId || isNaN(parseInt(eventId))) {
      return res
        .status(400)
        .json({ error: "A valid eventId must be provided in the URL." });
    }

    // --- Database Deletion ---
    conn = await pool.getConnection();
    const deleteQuery = `
      DELETE FROM astro_event_data 
      WHERE event_id = ?;
    `;
    const result = await conn.query(deleteQuery, [eventId]);

    // Check if a row was deleted
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ error: `Event with ID ${eventId} not found.` });
    }

    // --- Send Success Response ---
    res
      .status(200)
      .json({ message: `Event with ID ${eventId} was deleted successfully.` });
  } catch (err) {
    console.error("Delete Event Error:", err.message);
    res.status(500).json({
      error: "An error occurred while deleting the event.",
      details: err.message,
    });
  } finally {
    if (conn) conn.release();
  }
});

app.get("/api/events/:userId", async (req, res) => {
  const { authorization } = req.headers;
  const { userId } = req.params;

  let conn;
  if (!authorization) {
    return res.status(400).json({
      response:
        "Missing JWT token in Authorization header. Please provide a valid JWT token",
    });
  }

  try {
    const verified = await supabase.auth.getUser(authorization);
    if (!verified?.data?.user) {
      return res.status(400).json({
        response: "Invalid JWT token",
      });
    }

    if (verified.data.user.id !== userId) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You can only request your own data.",
      });
    }

    if (!userId) {
      return res
        .status(400)
        .json({ error: "User ID is required in the URL path." });
    }

    conn = await pool.getConnection();
    const query =
      "SELECT * FROM astro_event_data WHERE user_id = ? ORDER BY created_at DESC";
    const rows = await conn.query(query, [userId]);

    const events = rows.map((row) => {
      let parsedData;
      if (typeof row.event_data === "string") {
        try {
          parsedData = JSON.parse(row.event_data);
        } catch (e) {
          console.error(
            `Failed to parse event_data for event_id ${row.event_id}:`,
            e
          );
          parsedData = {
            error: "Failed to parse malformed JSON data from database.",
          };
        }
      } else {
        parsedData = row.event_data;
      }

      return {
        ...row,
        event_data: parsedData,
      };
    });

    // ✅ ADDED: Human-readable log for each event being sent to the client.
    console.log(`\n--- Sending ${events.length} Event(s) to Client ---`);
    events.forEach((event) => {
      logChartSummary(event.event_data, `Chart for "${event.label}"`);
    });
    console.log(`-------------------------------------\n`);

    res.json(events);
  } catch (err) {
    console.error("Fetch Events Error:", err.message);
    res.status(500).json({
      error: "An error occurred while fetching event data.",
      details: err.message,
    });
  } finally {
    if (conn) conn.release();
  }
});

app.post("/api/natal-chart", async (req, res) => {
  const { authorization } = req.headers;
  const { userId, label, year, month, day, time, location } = req.body;

  let conn;
  if (!authorization) {
    return res.status(400).json({
      response:
        "Missing JWT token in Authorization header. Please provide a valid JWT token",
    });
  }

  try {
    const verified = await supabase.auth.getUser(authorization);
    if (!verified?.data?.user) {
      return res.status(400).json({
        response: "Invalid JWT token",
      });
    }

    // ✅ CORRECTED: Security check now correctly compares the verified token's user ID
    // with the userId sent in the request body.
    if (verified.data.user.id !== userId) {
      return res.status(403).json({
        success: false,
        message:
          "Forbidden: You can only create events for your own user account.",
      });
    }

    if (!userId || !label || !year || !month || !day || !time || !location) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // Use the reusable helper to get all chart data
    const chartData = await calculateChart(year, month, day, time, location);

    // ✅ ADDED: Human-readable log of the created chart
    logChartSummary(chartData, `Natal Chart Created for "${label}"`);

    // --- Save to Database ---
    conn = await pool.getConnection();
    const insertQuery = `
      INSERT INTO astro_event_data (user_id, label, event_data) 
      VALUES (?, ?, ?);
    `;
    const eventDataString = JSON.stringify(chartData);
    const dbResult = await conn.query(insertQuery, [
      userId,
      label,
      eventDataString,
    ]);
    chartData.event_id = Number(dbResult.insertId);

    res.status(201).json(chartData);
  } catch (err) {
    console.error("POST /api/natal-chart Error:", err.message);
    res.status(500).json({
      error: "An error occurred while creating the natal chart.",
      details: err.message,
    });
  } finally {
    if (conn) conn.release();
  }
});

app.post("/api/query", async (req, res) => {
  const { authorization } = req.headers;
  // ✅ ADDED: Destructure all the new possible parameters
  const {
    userId,
    chartData,
    userQuestion,
    transitTimestamp,
    progressed,
    progressedEventIds,
    progressedTimezones,
    houseSystem = "P",
  } = req.body;

  let conn;

  if (!authorization) {
    return res.status(400).json({
      response:
        "Missing JWT token in Authorization header. Please provide a valid JWT token",
    });
  }

  // ✅ CORRECTED: Typo in 'authorization' variable
  const verified = await supabase.auth.getUser(authorization);
  if (!verified?.data?.user) {
    return res.status(400).json({
      response: "Invalid JWT token",
    });
  }

  if (verified.data.user.id !== userId) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: You can only request your own data.",
    });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    console.log(`User ${userId} made a query: ${userQuestion}`);

    if (!apiKey) {
      return res
        .status(500)
        .json({ error: "GEMINI_API_KEY not found on the server." });
    }
    if (!userId || !chartData || !userQuestion) {
      return res.status(400).json({
        error: "Missing userId, chartData, or userQuestion in the request.",
      });
    }

    // --- ✅ MODIFIED: Dynamic Chart Calculation & Logging ---
    let finalChartDataString = chartData;
    let additionalContext = "";

    if (
      progressed === true &&
      Array.isArray(progressedEventIds) &&
      progressedEventIds.length > 0
    ) {
      try {
        let charts = JSON.parse(chartData);
        if (!Array.isArray(charts)) charts = [charts];

        const updatedCharts = await Promise.all(
          charts.map(async (chart) => {
            if (progressedEventIds.includes(chart.event_id)) {
              const birthDate = DateTime.fromISO(chart.meta.date);
              const natalLocation = chart.meta.location;
              const customTimezone = progressedTimezones[chart.event_id];

              if (birthDate.isValid && natalLocation) {
                const ageInYears = DateTime.now().diff(
                  birthDate,
                  "years"
                ).years;
                const progressedDate = birthDate.plus({ days: ageInYears });

                const locationForCalc = customTimezone
                  ? cities.find((c) => c.timezone === customTimezone)?.name ||
                    natalLocation
                  : natalLocation;

                const progressedChartData = await calculateChart(
                  progressedDate.year,
                  progressedDate.month,
                  progressedDate.day,
                  progressedDate.toFormat("HH:mm:ss"),
                  locationForCalc,
                  false,
                  houseSystem
                );

                logChartSummary(
                  progressedChartData,
                  `Progressed Chart for Event ID ${chart.event_id}`
                );
                chart.progressedChart = progressedChartData;
              }
            }
            return chart;
          })
        );
        finalChartDataString = JSON.stringify(updatedCharts, null, 2);
      } catch (e) {
        console.error("Error processing progressed charts:", e.message);
      }
    }

    if (transitTimestamp) {
      try {
        const transitDate = DateTime.fromISO(transitTimestamp, {
          setZone: true,
        });
        if (transitDate.isValid) {
          const cityData = cities.find(
            (c) => c.timezone === transitDate.zoneName
          );
          const transitLocation = cityData
            ? `${cityData.city}, ${cityData.country}`
            : "Greenwich, UK";

          const transitChart = await calculateChart(
            transitDate.year,
            transitDate.month,
            transitDate.day,
            transitDate.toFormat("HH:mm:ss"),
            transitLocation,
            false,
            houseSystem
          );

          logChartSummary(
            transitChart,
            `Transit Chart for ${transitDate.toFormat("yyyy-MM-dd")}`
          );

          additionalContext = `\n\n**Transit Chart for ${transitDate.toFormat(
            "yyyy-MM-dd HH:mm"
          )}:**\n---
${JSON.stringify(transitChart, null, 2)}
---`;
        }
      } catch (e) {
        console.error("Error processing transit chart:", e.message);
      }
    }

    // --- Database Logic for Query Limit ---
    conn = await pool.getConnection();
    const [userStats] = await conn.query(checkQuery, [userId]);

    if (userStats && userStats.length > 0) {
      const today = new Date().toDateString();
      const lastQueryDay = new Date(
        userStats[0].last_query_timestamp
      ).toDateString();
      if (today === lastQueryDay && userStats[0].queries_today >= 5) {
        if (conn) conn.release();
        return res
          .status(429)
          .json({ error: "Query limit of 5 per day reached." });
      }
    }

    // --- Gemini API Call ---
    const prompt = `
      You are an expert astrologer with deep knowledge of various astrological techniques...
      Analyze the following astrological data and answer the user's question...

      **Astrological Data:**
      ---
      ${finalChartDataString}
      ---
      ${additionalContext}
      **User's Question:**
      ${userQuestion}

      **Your Interpretation:**
    `;

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`;
    const geminiResponse = await axios.post(
      apiUrl,
      {
        contents: [{ parts: [{ text: prompt }] }],
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const data = geminiResponse.data;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      if (conn) conn.release();
      return res
        .status(500)
        .json({ error: "The response from the AI was empty or malformed." });
    }

    // --- Database Update for Query Limit ---
    if (userStats && userStats.length > 0) {
      const today = new Date().toDateString();
      const lastQueryDay = new Date(
        userStats[0].last_query_timestamp
      ).toDateString();
      const updateQuery =
        today === lastQueryDay
          ? `UPDATE user_query_stats SET queries_today = queries_today + 1, last_query_timestamp = NOW() WHERE user_id = ?`
          : `UPDATE user_query_stats SET queries_today = 1, last_query_timestamp = NOW() WHERE user_id = ?`;
      await conn.query(updateQuery, [userId]);
    } else {
      const insertQuery = `INSERT INTO user_query_stats (user_id, queries_today, last_query_timestamp) VALUES (?, 1, NOW())`;
      await conn.query(insertQuery, [userId]);
    }

    res.json({ response: text });
  } catch (err) {
    console.error("Server Error:", err);
    res
      .status(500)
      .json({ error: err.message || "An unknown server error occurred." });
  } finally {
    if (conn) conn.release();
  }
});

// 6. Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);

  // Call the recalculation function immediately after the server starts.
  // It will run in the background and not block the server from accepting requests.
  recalculateAllChartsOnStartup();
});
