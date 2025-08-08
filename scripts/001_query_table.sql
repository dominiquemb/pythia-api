--
-- MariaDB SQL script to create a table for tracking user query statistics
--

-- Create the database if it doesn't exist
CREATE DATABASE IF NOT EXISTS `pythia`;

-- Use the new database
USE `pythia`;

-- Drop the table if it already exists to ensure a clean creation
DROP TABLE IF EXISTS `user_query_stats`;

-- Create the user_query_stats table
CREATE TABLE `user_query_stats` (
    -- The user's unique identifier, stored as a UUID string.
    -- We'll use VARCHAR(36) as UUIDs are typically 36 characters long.
    `user_id` VARCHAR(36) NOT NULL PRIMARY KEY,

    -- The number of queries made by the user today.
    -- This should be reset daily by your application logic.
    `queries_today` INT NOT NULL DEFAULT 0,

    -- The timestamp of the last time this record was updated.
    -- We use ON UPDATE CURRENT_TIMESTAMP to automatically update it
    -- whenever the record is changed.
    `last_query_timestamp` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Show a confirmation message
SELECT 'Table user_query_stats created successfully.' AS Message;

