-- Add email column to students table
alter table students
  add column if not exists email text;
