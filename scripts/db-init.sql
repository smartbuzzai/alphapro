-- db-init.sql
-- Runs once when PostgreSQL container first starts.
-- Creates the Unleash database alongside the app DB.

CREATE DATABASE unleash;
GRANT ALL PRIVILEGES ON DATABASE unleash TO current_user;
