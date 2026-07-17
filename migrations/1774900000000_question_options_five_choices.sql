-- Allow up to 5 MCQ options (indices 0–4) in question bank

ALTER TABLE question_options
  DROP CONSTRAINT IF EXISTS question_options_option_index_check;

ALTER TABLE question_options
  ADD CONSTRAINT question_options_option_index_check
  CHECK (option_index >= 0 AND option_index <= 4);
