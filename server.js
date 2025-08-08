// server.js

// 1. Import necessary packages
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch"); // Use node-fetch for making requests in Node.js
const axios = require("axios");
const mariadb = require("mariadb"); // Import the MariaDB package
const sweph = require("swisseph"); // Import Swiss Ephemeris for astrological calculations
const { DateTime } = require("luxon"); // <<< ADD THIS LINE

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

app.get("/api/events/:userId", async (req, res) => {
  let conn;
  try {
    const { userId } = req.params;

    if (!userId) {
      return res
        .status(400)
        .json({ error: "User ID is required in the URL path." });
    }

    conn = await pool.getConnection();
    const query =
      "SELECT * FROM astro_event_data WHERE user_id = ? ORDER BY created_at DESC";
    const rows = await conn.query(query, [userId]);

    // The 'event_data' column might be a string or an object.
    // This handles both cases to prevent parsing errors.
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
        // If it's not a string, assume it's already a valid object
        parsedData = row.event_data;
      }

      return {
        ...row,
        event_data: parsedData,
      };
    });

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
  let conn; // Define connection variable to be accessible in the finally block
  try {
    // 1. Destructure all data from the request body, including userId and label
    const { userId, label, year, month, day, time, location } = req.body;

    // --- Validation for all required fields ---
    if (!userId || !label || !year || !month || !day || !time || !location) {
      return res.status(400).json({
        error:
          "Missing required fields (userId, label, year, month, day, time, location).",
      });
    }

    // --- Geocoding and Timezone Conversion ---
    const geocodingApiKey = process.env.GEOCODING_API_KEY;
    if (!geocodingApiKey) {
      return res
        .status(500)
        .json({ error: "GEOCODING_API_KEY not found on the server." });
    }

    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      location
    )}&key=${geocodingApiKey}`;
    const geocodeResponse = await axios.get(geocodeUrl);
    const geoData = geocodeResponse.data;

    if (geoData.status !== "OK" || !geoData.results[0]) {
      return res
        .status(400)
        .json({ error: "Could not geocode the provided location." });
    }

    const { lat, lng } = geoData.results[0].geometry.location;
    const formattedLocation = geoData.results[0].formatted_address;

    const isoString = `${year}-${String(month).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}T${time}`;
    const localBirthTime = DateTime.fromISO(isoString);

    const timezoneUrl = `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${localBirthTime.toSeconds()}&key=${geocodingApiKey}`;
    const timezoneResponse = await axios.get(timezoneUrl);
    const tzData = timezoneResponse.data;

    if (tzData.status !== "OK") {
      return res
        .status(500)
        .json({ error: "Could not determine the timezone for the location." });
    }

    const utcBirthTime = DateTime.fromISO(isoString, {
      zone: tzData.timeZoneId,
    }).toUTC();

    if (!utcBirthTime.isValid) {
      return res.status(400).json({
        error: "Invalid date or time provided.",
        details: utcBirthTime.invalidReason,
      });
    }

    // --- Astrological Calculations using Swiss Ephemeris ---
    sweph.swe_set_ephe_path(__dirname + "/ephe");

    const julianDayUT = sweph.swe_julday(
      utcBirthTime.year,
      utcBirthTime.month,
      utcBirthTime.day,
      utcBirthTime.hour + utcBirthTime.minute / 60 + utcBirthTime.second / 3600,
      sweph.SE_GREG_CAL
    );

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

    const chartData = {
      meta: {
        date: utcBirthTime.toFormat("yyyy-MM-dd HH:mm:ss 'UTC'"),
        location: formattedLocation,
        latitude: lat,
        longitude: lng,
      },
      positions: {},
    };

    for (const [name, id] of Object.entries(planets)) {
      const result = sweph.swe_calc_ut(
        julianDayUT,
        id,
        sweph.SEFLG_SPEED | sweph.SEFLG_JPLEPH // Using JPL Ephemeris
      );
      if (result.error) {
        console.error(`Swiss Ephemeris error for ${name}:`, result.error);
        chartData.positions[name] = { error: result.error };
      } else {
        chartData.positions[name] = {
          longitude: result.longitude,
          latitude: result.latitude,
          speed: result.longitude_speed,
        };
      }
    }

    const houseSystem = "P";
    const houses = sweph.swe_houses(julianDayUT, lat, lng, houseSystem);

    if (houses.error || !houses.house) {
      console.error("Could not calculate house cusps:", houses.error);
      chartData.houses = { error: "House calculation failed." };
    } else {
      chartData.houses = {
        system: houseSystem,
        ascendant: houses.asc,
        mc: houses.mc,
        cusps: {
          1: houses.house[0],
          2: houses.house[1],
          3: houses.house[2],
          4: houses.house[3],
          5: houses.house[4],
          6: houses.house[5],
          7: houses.house[6],
          8: houses.house[7],
          9: houses.house[8],
          10: houses.house[9],
          11: houses.house[10],
          12: houses.house[11],
        },
      };
    }

    const aspects = {
      conjunction: { angle: 0, orb: 8, color: "#4a4a4a" },
      opposition: { angle: 180, orb: 8, color: "#ff4d4d" },
      trine: { angle: 120, orb: 8, color: "#2b8a3e" },
      square: { angle: 90, orb: 8, color: "#e03131" },
      sextile: { angle: 60, orb: 6, color: "#1c7ed6" },
      quincunx: { angle: 150, orb: 3, color: "#f08c00" },
      quintile: { angle: 72, orb: 2, color: "#862e9c" },
      semisextile: { angle: 30, orb: 2, color: "#495057" },
      semisquare: { angle: 45, orb: 2, color: "#c92a2a" },
    };

    const planetNames = Object.keys(chartData.positions);
    const calculatedAspects = [];

    for (let i = 0; i < planetNames.length; i++) {
      for (let j = i + 1; j < planetNames.length; j++) {
        const planet1 = chartData.positions[planetNames[i]];
        const planet2 = chartData.positions[planetNames[j]];
        if (!planet1 || planet1.error || !planet2 || planet2.error) continue;
        let angle = Math.abs(planet1.longitude - planet2.longitude);
        if (angle > 180) angle = 360 - angle;
        for (const aspectName in aspects) {
          const aspect = aspects[aspectName];
          if (Math.abs(angle - aspect.angle) <= aspect.orb) {
            calculatedAspects.push({
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
    chartData.aspects = calculatedAspects;

    // --- ✅ NEW: Save Event to Database ---
    conn = await pool.getConnection();
    const insertQuery = `
      INSERT INTO astro_event_data (user_id, label, event_data) 
      VALUES (?, ?, ?);
    `;
    // Convert the complete chart data object to a JSON string for storage
    const eventDataString = JSON.stringify(chartData);
    const dbResult = await conn.query(insertQuery, [
      userId,
      label,
      eventDataString,
    ]);

    // Add the new event_id to the response for the client's reference
    chartData.event_id = Number(dbResult.insertId);

    // --- Send Response ---
    // Use 201 Created status code for successful resource creation
    res.status(201).json(chartData);
  } catch (err) {
    console.error("Natal Chart Error:", err.message);
    res.status(500).json({
      error: "An error occurred while calculating and saving the natal chart.",
      details: err.message,
    });
  } finally {
    // Ensure the database connection is released if it was acquired
    if (conn) conn.release();
    // Close the Swiss Ephemeris files
    sweph.swe_close();
  }
});

// 5. Define the API route
app.post("/api/query", async (req, res) => {
  let conn; // Declare a variable for the database connection

  try {
    // Destructure the data sent from the React frontend, now including the userId
    const { userId, chartData, userQuestion } = req.body;

    // Securely get the API key from the server's environment variables
    const apiKey = process.env.GEMINI_API_KEY;

    console.log(`User ${userId} made a query: ${userQuestion}`);

    // --- Validation ---
    if (!apiKey) {
      // Use return to stop execution
      return res
        .status(500)
        .json({ error: "GEMINI_API_KEY not found on the server." });
    }
    if (!userId || !chartData || !userQuestion) {
      return res.status(400).json({
        error: "Missing userId, chartData, or userQuestion in the request.",
      });
    }

    // --- Database Logic for Query Limit ---
    // Get a connection from the pool
    conn = await pool.getConnection();

    // Query to check the user's current query count and last timestamp
    const checkQuery = `SELECT queries_today, last_query_timestamp FROM user_query_stats WHERE user_id = ?`;
    const userStats = await conn.query(checkQuery, [userId]);

    if (userStats.length > 0) {
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
    // If the request wasn't blocked, proceed with the API call
    const prompt = `
      You are an expert astrologer with deep knowledge of various astrological techniques including natal charts, synastry, composite charts, progressed charts, astrocartography, and zodiacal releasing.
      Analyze the following astrological data and answer the user's question based on it. Provide a thoughtful, detailed, and insightful interpretation without unnecessary flattery.
      **Astrological Data:**
      ---
      ${chartData}
      ---
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
      {
        headers: { "Content-Type": "application/json" },
      }
    );

    // Access the data directly from geminiResponse.data
    const data = geminiResponse.data;

    // The rest of your code remains the same
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      // Release the connection before sending the response
      if (conn) conn.release();
      return res
        .status(500)
        .json({ error: "The response from the AI was empty or malformed." });
    }

    if (userStats.length > 0) {
      const today = new Date().toDateString();
      const lastQueryDay = new Date(
        userStats[0].last_query_timestamp
      ).toDateString();
      if (today === lastQueryDay) {
        const updateQuery = `UPDATE user_query_stats SET queries_today = queries_today + 1, last_query_timestamp = NOW() WHERE user_id = ?`;
        await conn.query(updateQuery, [userId]);
      } else {
        const updateQuery = `UPDATE user_query_stats SET queries_today = 1, last_query_timestamp = NOW() WHERE user_id = ?`;
        await conn.query(updateQuery, [userId]);
      }
    } else {
      const insertQuery = `INSERT INTO user_query_stats (user_id, queries_today, last_query_timestamp) VALUES (?, 1, NOW())`;
      await conn.query(insertQuery, [userId]);
    }

    // Send the successful response back to the React frontend
    res.json({ response: text });
  } catch (err) {
    console.error("Server Error:", err);
    res
      .status(500)
      .json({ error: err.message || "An unknown server error occurred." });
  } finally {
    // Ensure the connection is released in all cases
    if (conn) {
      conn.release();
    }
  }
});

// 6. Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
