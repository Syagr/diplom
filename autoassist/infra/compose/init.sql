-- AutoAssist+ Database Initialization Script
-- Creates database structure if running in fresh environment

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create database if it doesn't exist (handled by POSTGRES_DB env var)
-- Additional initialization can be added here