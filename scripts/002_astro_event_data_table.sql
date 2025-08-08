-- Select the database to use.
-- It's good practice to include this to ensure the table is created in the correct place.
USE pythia;

-- Create the astro_event_data table if it doesn't already exist.
-- This table stores various astrological events, which can belong to a user or be historical events.
CREATE TABLE IF NOT EXISTS astro_event_data (
    -- A unique, auto-incrementing identifier for each event record.
    event_id INT AUTO_INCREMENT PRIMARY KEY,

    -- The ID of the user who created this event record.
    -- This links the event data back to a specific user.
    user_id VARCHAR(255) NOT NULL,

    -- A descriptive label for the event data (e.g., "John Smith", "Founding of the USA").
    label VARCHAR(255) NOT NULL,

    -- The complete natal chart data, stored as a JSON string.
    -- The JSON type is efficient for storing and querying structured data.
    event_data JSON NOT NULL,

    -- Timestamp for when this record was first created.
    -- Defaults to the current time on insertion.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Timestamp for the last time this record was updated.
    -- Automatically updates to the current time whenever the row is modified.
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- An index on user_id to speed up queries that fetch all events for a specific user.
    INDEX (user_id)
);

