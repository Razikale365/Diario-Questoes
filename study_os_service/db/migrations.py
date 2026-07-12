import sqlite3


class UnsupportedSchemaVersionError(RuntimeError):
    """Raised when a database was created by a newer Study OS version."""


MIGRATIONS = (
    (
        1,
        (
            """
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
""",
            """
CREATE TABLE IF NOT EXISTS app_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','error')),
  message TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
""",
        ),
    ),
    (
        2,
        (
            """
CREATE TABLE course_roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_slug TEXT NOT NULL CHECK (length(trim(target_slug)) > 0),
  provider TEXT NOT NULL CHECK (length(trim(provider)) > 0),
  package_name TEXT NOT NULL CHECK (length(trim(package_name)) > 0),
  package_id TEXT,
  package_url TEXT NOT NULL CHECK (package_url GLOB 'http*://*'),
  edition_note TEXT NOT NULL DEFAULT '',
  root_path TEXT NOT NULL COLLATE NOCASE UNIQUE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('course_package','manual_folder','legacy')),
  acquisition_method TEXT NOT NULL CHECK (acquisition_method IN ('estrategia_downloader','manual')),
  download_status TEXT NOT NULL CHECK (download_status IN ('candidate','selected','downloaded','validated')),
  downloader_name TEXT,
  downloader_version TEXT,
  acquisition_id TEXT,
  catalog_checked_at TEXT NOT NULL,
  download_started_at TEXT,
  downloaded_at TEXT,
  acquisition_manifest_path TEXT,
  expected_file_count INTEGER CHECK (expected_file_count IS NULL OR expected_file_count >= 0),
  observed_file_count INTEGER CHECK (observed_file_count IS NULL OR observed_file_count >= 0),
  failed_item_count INTEGER CHECK (failed_item_count IS NULL OR failed_item_count >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  last_scanned_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
""",
            """
CREATE TABLE courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id INTEGER NOT NULL REFERENCES course_roots(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  provider TEXT NOT NULL CHECK (length(trim(provider)) > 0),
  relative_path TEXT NOT NULL COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  scan_state TEXT NOT NULL DEFAULT 'available' CHECK (scan_state IN ('available','missing','unresolved')),
  last_scanned_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (root_id, relative_path)
);
""",
            """
CREATE TABLE disciplines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(canonical_name)) > 0),
  aliases_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(aliases_json) AND json_type(aliases_json) = 'array'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
""",
            """
CREATE TABLE course_disciplines (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  discipline_id INTEGER NOT NULL REFERENCES disciplines(id) ON DELETE RESTRICT,
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  PRIMARY KEY (course_id, discipline_id)
);
""",
            """
CREATE TABLE lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  discipline_id INTEGER REFERENCES disciplines(id) ON DELETE SET NULL,
  lesson_number INTEGER CHECK (lesson_number IS NULL OR lesson_number >= 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  sequence_index INTEGER NOT NULL CHECK (sequence_index >= 0),
  status TEXT NOT NULL DEFAULT 'unread'
    CHECK (status IN ('unread','in_progress','completed','skipped')),
  estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes >= 0),
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (course_id, discipline_id, sequence_index)
);
""",
            """
CREATE TABLE materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
  absolute_path TEXT NOT NULL,
  relative_path TEXT NOT NULL COLLATE NOCASE,
  normalized_relative_path TEXT NOT NULL COLLATE NOCASE,
  kind TEXT NOT NULL CHECK (
    kind IN ('original','simplified','highlighted','slides','mind_map','summary','bizu','track','other')
  ),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  modified_at TEXT NOT NULL,
  content_hash TEXT,
  page_count INTEGER CHECK (page_count IS NULL OR page_count > 0),
  page_offset INTEGER NOT NULL DEFAULT 0 CHECK (page_offset >= 0),
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  primary_selection TEXT CHECK (primary_selection IS NULL OR primary_selection IN ('automatic','manual')),
  trust_level INTEGER NOT NULL CHECK (trust_level BETWEEN 0 AND 10),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (is_primary = 1 AND primary_selection IS NOT NULL)
    OR (is_primary = 0 AND primary_selection IS NULL)
  ),
  UNIQUE (course_id, normalized_relative_path)
);
""",
            """
CREATE TABLE import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id INTEGER NOT NULL REFERENCES course_roots(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('queued','running','completed','failed')),
  discovered_count INTEGER NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
  reconciled_count INTEGER NOT NULL DEFAULT 0 CHECK (reconciled_count >= 0),
  issue_count INTEGER NOT NULL DEFAULT 0 CHECK (issue_count >= 0),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  error_message TEXT
);
""",
            """
CREATE TABLE import_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_run_id INTEGER NOT NULL REFERENCES import_runs(id) ON DELETE RESTRICT,
  root_id INTEGER NOT NULL REFERENCES course_roots(id) ON DELETE RESTRICT,
  issue_kind TEXT NOT NULL CHECK (length(trim(issue_kind)) > 0),
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','error')),
  relative_path TEXT,
  context_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(context_json) AND json_type(context_json) = 'object'),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved','ignored')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);
""",
            "CREATE INDEX idx_courses_root_active ON courses(root_id, active);",
            "CREATE INDEX idx_lessons_course_sequence ON lessons(course_id, sequence_index);",
            "CREATE INDEX idx_materials_lesson_available ON materials(lesson_id, available);",
            "CREATE UNIQUE INDEX idx_materials_one_primary_per_lesson ON materials(lesson_id) WHERE is_primary = 1 AND lesson_id IS NOT NULL;",
            "CREATE INDEX idx_import_runs_root_state ON import_runs(root_id, state);",
            "CREATE INDEX idx_import_issues_root_state ON import_issues(root_id, state);",
        ),
    ),
    (
        3,
        (
            """
ALTER TABLE lessons
ADD COLUMN mapping_source TEXT NOT NULL DEFAULT 'automatic'
  CHECK (mapping_source IN ('automatic','manual'));
""",
        ),
    ),
    (
        4,
        (
            """
CREATE TABLE progress_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE RESTRICT,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'unread'
    CHECK (status IN ('unread','in_progress','covered','stale','weak','strong')),
  cursor_page INTEGER NOT NULL DEFAULT 1 CHECK (cursor_page >= 1),
  furthest_page INTEGER NOT NULL DEFAULT 1 CHECK (furthest_page >= cursor_page),
  completed_at TEXT,
  last_seen_at TEXT,
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  total_seconds INTEGER NOT NULL DEFAULT 0 CHECK (total_seconds >= 0),
  session_count INTEGER NOT NULL DEFAULT 0 CHECK (session_count >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (lesson_id, material_id)
);
""",
            """
CREATE TABLE study_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
  target_slug TEXT NOT NULL CHECK (length(trim(target_slug)) > 0),
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE RESTRICT,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','finished')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  elapsed_seconds INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_seconds >= 0),
  start_page INTEGER NOT NULL CHECK (start_page >= 1),
  end_page INTEGER CHECK (end_page IS NULL OR end_page >= start_page),
  questions_done INTEGER NOT NULL DEFAULT 0 CHECK (questions_done >= 0),
  correct_count INTEGER NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  wrong_count INTEGER NOT NULL DEFAULT 0 CHECK (wrong_count >= 0),
  doubt_count INTEGER NOT NULL DEFAULT 0 CHECK (doubt_count >= 0),
  favorite_count INTEGER NOT NULL DEFAULT 0 CHECK (favorite_count >= 0),
  outcome TEXT CHECK (
    outcome IS NULL OR outcome IN ('partial','completed','failed','skipped','abandoned')
  ),
  skip_reason TEXT CHECK (
    skip_reason IS NULL OR skip_reason IN (
      'lack_of_time','fatigue','wrong_material',
      'blocked_prerequisite','too_difficult','other'
    )
  ),
  notes TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (state='active' AND outcome IS NULL AND ended_at IS NULL)
    OR (state='finished' AND outcome IS NOT NULL AND ended_at IS NOT NULL)
  ),
  CHECK (
    (outcome='skipped' AND skip_reason IS NOT NULL)
    OR (outcome IS NULL AND skip_reason IS NULL)
    OR (outcome IS NOT NULL AND outcome!='skipped' AND skip_reason IS NULL)
  )
);
""",
            "CREATE INDEX idx_progress_material_status ON progress_states(material_id, status);",
            "CREATE INDEX idx_sessions_target_started ON study_sessions(target_slug, started_at);",
            "CREATE UNIQUE INDEX idx_sessions_one_active_material ON study_sessions(lesson_id, material_id) WHERE state='active';",
        ),
    ),
    (
        5,
        (
            """
CREATE TABLE exam_targets (
  target_slug TEXT PRIMARY KEY CHECK (length(trim(target_slug)) > 0),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  institution TEXT NOT NULL CHECK (length(trim(institution)) > 0),
  role TEXT NOT NULL CHECK (length(trim(role)) > 0),
  banca TEXT NOT NULL CHECK (length(trim(banca)) > 0),
  phase TEXT NOT NULL CHECK (phase IN ('pre_edital','pos_edital')),
  deadline TEXT,
  daily_quota INTEGER NOT NULL DEFAULT 4 CHECK (daily_quota BETWEEN 1 AND 8),
  priority_score REAL NOT NULL DEFAULT 50 CHECK (priority_score BETWEEN 0 AND 100),
  source_urls_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(source_urls_json) AND json_type(source_urls_json) = 'array'),
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (deadline IS NULL OR (length(deadline) = 10 AND date(deadline) = deadline))
);
""",
            """
CREATE TABLE target_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
  discipline TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(discipline)) > 0),
  topic TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(topic)) > 0),
  coverage_status TEXT NOT NULL DEFAULT 'unread'
    CHECK (coverage_status IN ('unread','in_progress','covered','stale','weak','strong')),
  edital_weight REAL NOT NULL DEFAULT 1 CHECK (edital_weight BETWEEN 0 AND 10),
  incidence REAL NOT NULL DEFAULT 0 CHECK (incidence BETWEEN 0 AND 100),
  tier INTEGER NOT NULL DEFAULT 3 CHECK (tier BETWEEN 1 AND 5),
  banca_fit REAL NOT NULL DEFAULT 0 CHECK (banca_fit BETWEEN 0 AND 100),
  overlap_value REAL NOT NULL DEFAULT 0 CHECK (overlap_value BETWEEN 0 AND 100),
  transfer_kind TEXT NOT NULL DEFAULT 'target_specific'
    CHECK (transfer_kind IN ('target_specific','shared','partial')),
  source_kind TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('course','tec','ls','trilha','manual','bizu')),
  lesson_id INTEGER REFERENCES lessons(id) ON DELETE RESTRICT,
  material_id INTEGER REFERENCES materials(id) ON DELETE RESTRICT,
  tec_source_url TEXT,
  tec_source_id TEXT,
  planned_questions INTEGER NOT NULL DEFAULT 0 CHECK (planned_questions >= 0),
  review_debt REAL NOT NULL DEFAULT 0 CHECK (review_debt BETWEEN 0 AND 100),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (target_slug, discipline, topic),
  CHECK (material_id IS NULL OR lesson_id IS NOT NULL),
  CHECK (tec_source_url IS NULL OR tec_source_url GLOB 'http*://*')
);
""",
            """
CREATE TABLE planner_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
  target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
  plan_date TEXT NOT NULL CHECK (length(plan_date) = 10 AND date(plan_date) = plan_date),
  phase TEXT NOT NULL CHECK (phase IN ('pre_edital','pos_edital')),
  daily_quota INTEGER NOT NULL CHECK (daily_quota BETWEEN 1 AND 8),
  time_budget_minutes INTEGER NOT NULL CHECK (time_budget_minutes BETWEEN 15 AND 720),
  algorithm_version TEXT NOT NULL CHECK (length(trim(algorithm_version)) > 0),
  input_hash TEXT NOT NULL CHECK (length(trim(input_hash)) > 0),
  supersedes_run_id INTEGER REFERENCES planner_runs(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('generated','shortfall')),
  shortfall_count INTEGER NOT NULL DEFAULT 0 CHECK (shortfall_count >= 0),
  shortfall_reasons_json TEXT NOT NULL DEFAULT '[]'
    CHECK (
      json_valid(shortfall_reasons_json)
      AND json_type(shortfall_reasons_json) = 'array'
      AND json_array_length(shortfall_reasons_json) = shortfall_count
    ),
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (status='generated' AND shortfall_count=0)
    OR (status='shortfall' AND shortfall_count > 0)
  )
);
""",
            """
CREATE TABLE planner_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES planner_runs(id) ON DELETE RESTRICT,
  candidate_key TEXT NOT NULL CHECK (length(trim(candidate_key)) > 0),
  target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
  discipline TEXT NOT NULL CHECK (length(trim(discipline)) > 0),
  topic TEXT NOT NULL CHECK (length(trim(topic)) > 0),
  block_kind TEXT NOT NULL CHECK (block_kind IN ('theory','questions','review')),
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('course','tec','ls','trilha','manual','bizu')),
  target_topic_id INTEGER REFERENCES target_topics(id) ON DELETE RESTRICT,
  lesson_id INTEGER REFERENCES lessons(id) ON DELETE RESTRICT,
  material_id INTEGER REFERENCES materials(id) ON DELETE RESTRICT,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 45 AND 75),
  planned_questions INTEGER NOT NULL DEFAULT 0 CHECK (planned_questions >= 0),
  weakness INTEGER NOT NULL CHECK (weakness BETWEEN 0 AND 10000),
  incidence INTEGER NOT NULL CHECK (incidence BETWEEN 0 AND 10000),
  tier INTEGER NOT NULL CHECK (tier BETWEEN 0 AND 10000),
  coverage_need INTEGER NOT NULL CHECK (coverage_need BETWEEN 0 AND 10000),
  review_debt INTEGER NOT NULL CHECK (review_debt BETWEEN 0 AND 10000),
  ls_alignment INTEGER NOT NULL CHECK (ls_alignment BETWEEN 0 AND 10000),
  target_fit INTEGER NOT NULL CHECK (target_fit BETWEEN 0 AND 10000),
  overlap_value INTEGER NOT NULL CHECK (overlap_value BETWEEN 0 AND 10000),
  deadline_pressure INTEGER NOT NULL CHECK (deadline_pressure BETWEEN 0 AND 10000),
  banca_fit INTEGER NOT NULL CHECK (banca_fit BETWEEN 0 AND 10000),
  edital_weight INTEGER NOT NULL CHECK (edital_weight BETWEEN 0 AND 10000),
  balance_penalty INTEGER NOT NULL DEFAULT 0 CHECK (balance_penalty BETWEEN 0 AND 10000),
  low_trust_penalty INTEGER NOT NULL DEFAULT 0 CHECK (low_trust_penalty BETWEEN 0 AND 10000),
  final_score INTEGER NOT NULL CHECK (final_score BETWEEN -1000000000 AND 1000000000),
  chosen_position INTEGER CHECK (chosen_position IS NULL OR chosen_position > 0),
  displaced_by_candidate_key TEXT,
  stop_reason TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'object'),
  UNIQUE (run_id, candidate_key),
  UNIQUE (run_id, chosen_position),
  CHECK (material_id IS NULL OR lesson_id IS NOT NULL),
  CHECK (
    (block_kind='theory' AND planned_questions=0)
    OR (block_kind IN ('questions','review') AND planned_questions > 0)
  ),
  CHECK (
    chosen_position IS NULL
    OR (stop_reason IS NULL AND displaced_by_candidate_key IS NULL)
  ),
  CHECK (stop_reason IS NULL OR displaced_by_candidate_key IS NULL)
);
""",
            """
CREATE TABLE planner_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES planner_runs(id) ON DELETE RESTRICT,
  candidate_id INTEGER NOT NULL UNIQUE REFERENCES planner_candidates(id) ON DELETE RESTRICT,
  target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
  scheduled_date TEXT NOT NULL
    CHECK (length(scheduled_date) = 10 AND date(scheduled_date) = scheduled_date),
  position INTEGER NOT NULL CHECK (position > 0),
  block_kind TEXT NOT NULL CHECK (block_kind IN ('theory','questions','review')),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 45 AND 75),
  planned_questions INTEGER NOT NULL DEFAULT 0 CHECK (planned_questions >= 0),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','active','completed','skipped','failed')),
  execution_session_id INTEGER REFERENCES study_sessions(id) ON DELETE RESTRICT,
  questions_done INTEGER NOT NULL DEFAULT 0 CHECK (questions_done >= 0),
  correct_count INTEGER NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  wrong_count INTEGER NOT NULL DEFAULT 0 CHECK (wrong_count >= 0),
  doubt_count INTEGER NOT NULL DEFAULT 0 CHECK (doubt_count >= 0),
  favorite_count INTEGER NOT NULL DEFAULT 0 CHECK (favorite_count >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_id, position),
  CHECK (correct_count + wrong_count <= questions_done),
  CHECK (
    (block_kind='theory' AND planned_questions=0 AND questions_done=0)
    OR (block_kind IN ('questions','review') AND planned_questions > 0)
  ),
  CHECK (
    state NOT IN ('pending','active')
    OR (
      questions_done=0 AND correct_count=0 AND wrong_count=0
      AND doubt_count=0 AND favorite_count=0
    )
  )
);
""",
            "CREATE INDEX idx_target_topics_target_active ON target_topics(target_slug, active);",
            "CREATE INDEX idx_target_topics_material ON target_topics(material_id);",
            "CREATE INDEX idx_planner_runs_target_date ON planner_runs(target_slug, plan_date, id);",
            "CREATE INDEX idx_planner_candidates_run_score ON planner_candidates(run_id, final_score DESC, candidate_key);",
            "CREATE INDEX idx_planner_candidates_run_chosen ON planner_candidates(run_id, chosen_position);",
            "CREATE INDEX idx_planner_blocks_target_date_state ON planner_blocks(target_slug, scheduled_date, state);",
        ),
    ),
    (
        6,
        (
            "ALTER TABLE target_topics ADD COLUMN notes TEXT NOT NULL DEFAULT '';",
        ),
    ),
    (
        7,
        (
            "CREATE UNIQUE INDEX ux_target_topics_target_id ON target_topics(target_slug, id);",
            """
            CREATE TABLE learning_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              idempotency_key TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
              target_slug TEXT NOT NULL CHECK (length(trim(target_slug)) > 0),
              topic_target_slug TEXT,
              target_topic_id INTEGER,
              source_kind TEXT NOT NULL CHECK (source_kind IN (
                'planner_block','study_session','legacy_aggregate','manual'
              )),
              source_id TEXT NOT NULL CHECK (length(trim(source_id)) > 0),
              event_kind TEXT NOT NULL CHECK (event_kind IN (
                'theory','questions','review','coverage_audit'
              )),
              outcome TEXT NOT NULL CHECK (outcome IN (
                'completed','partial','skipped','failed','abandoned','imported','audited'
              )),
              questions_done INTEGER NOT NULL DEFAULT 0 CHECK (questions_done >= 0),
              correct_count INTEGER NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
              wrong_count INTEGER NOT NULL DEFAULT 0 CHECK (wrong_count >= 0),
              doubt_count INTEGER NOT NULL DEFAULT 0 CHECK (doubt_count >= 0),
              favorite_count INTEGER NOT NULL DEFAULT 0 CHECK (favorite_count >= 0),
              elapsed_seconds INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_seconds >= 0),
              start_page INTEGER CHECK (start_page >= 1),
              end_page INTEGER CHECK (end_page >= 1),
              occurred_at TEXT NOT NULL,
              evidence_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(evidence_json) AND json_type(evidence_json)='object'),
              created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              UNIQUE (source_kind, source_id),
              FOREIGN KEY (topic_target_slug, target_topic_id)
                REFERENCES target_topics(target_slug, id),
              CHECK (
                (topic_target_slug IS NULL AND target_topic_id IS NULL)
                OR (topic_target_slug IS NOT NULL AND target_topic_id IS NOT NULL)
              ),
              CHECK (correct_count + wrong_count <= questions_done),
              CHECK (
                event_kind!='coverage_audit' OR (
                  questions_done=0 AND correct_count=0 AND wrong_count=0
                  AND doubt_count=0 AND favorite_count=0
                )
              ),
              CHECK (
                event_kind NOT IN ('questions','review')
                OR outcome IN ('skipped','failed') OR questions_done > 0
              ),
              CHECK (
                outcome!='skipped' OR (
                  questions_done=0 AND correct_count=0 AND wrong_count=0
                  AND doubt_count=0 AND favorite_count=0
                )
              ),
              CHECK (outcome!='partial' OR event_kind='theory'),
              CHECK (
                (start_page IS NULL AND end_page IS NULL)
                OR (event_kind='theory' AND start_page IS NOT NULL
                    AND end_page IS NOT NULL AND end_page >= start_page)
              )
            );
            """,
            """
            CREATE TABLE topic_learning_states (
              target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug),
              topic_target_slug TEXT NOT NULL,
              target_topic_id INTEGER NOT NULL,
              mastery_bp INTEGER NOT NULL DEFAULT 0 CHECK (mastery_bp BETWEEN 0 AND 10000),
              confidence_bp INTEGER NOT NULL DEFAULT 0 CHECK (confidence_bp BETWEEN 0 AND 10000),
              coverage_status TEXT NOT NULL DEFAULT 'unread' CHECK (coverage_status IN (
                'unread','in_progress','covered','stale','weak','strong'
              )),
              review_debt_bp INTEGER NOT NULL DEFAULT 0 CHECK (review_debt_bp BETWEEN 0 AND 10000),
              last_activity_at TEXT,
              last_success_at TEXT,
              next_review_date TEXT,
              stale_at TEXT,
              success_streak INTEGER NOT NULL DEFAULT 0 CHECK (success_streak >= 0),
              failure_streak INTEGER NOT NULL DEFAULT 0 CHECK (failure_streak >= 0),
              event_cursor INTEGER NOT NULL DEFAULT 0 CHECK (event_cursor >= 0),
              version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
              updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              PRIMARY KEY (target_slug, target_topic_id),
              FOREIGN KEY (topic_target_slug, target_topic_id)
                REFERENCES target_topics(target_slug, id),
              CHECK (last_success_at IS NULL OR last_activity_at IS NOT NULL),
              CHECK (next_review_date IS NULL OR date(next_review_date)=next_review_date),
              CHECK (stale_at IS NULL OR date(stale_at)=stale_at)
            );
            """,
            """
            CREATE TABLE review_queue_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug),
              topic_target_slug TEXT NOT NULL,
              target_topic_id INTEGER NOT NULL,
              due_date TEXT NOT NULL CHECK (date(due_date)=due_date),
              state TEXT NOT NULL DEFAULT 'pending'
                CHECK (state IN ('pending','deferred','resolved')),
              bounded_questions INTEGER NOT NULL
                CHECK (bounded_questions BETWEEN 5 AND 10),
              trigger_event_ids_json TEXT NOT NULL
                CHECK (json_valid(trigger_event_ids_json)
                  AND json_type(trigger_event_ids_json)='array'
                  AND json_array_length(trigger_event_ids_json) > 0),
              reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
              debt_bp INTEGER NOT NULL CHECK (debt_bp BETWEEN 0 AND 10000),
              attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
              resolved_event_id INTEGER REFERENCES learning_events(id),
              version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
              created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              FOREIGN KEY (topic_target_slug, target_topic_id)
                REFERENCES target_topics(target_slug, id),
              CHECK (
                (state='resolved' AND resolved_event_id IS NOT NULL)
                OR (state!='resolved' AND resolved_event_id IS NULL)
              )
            );
            """,
            """
            CREATE TABLE planner_week_runs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              idempotency_key TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
              target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug),
              week_start TEXT NOT NULL CHECK (
                date(week_start)=week_start AND strftime('%w', week_start)='1'
              ),
              phase TEXT NOT NULL CHECK (phase IN ('pre_edital','pos_edital')),
              algorithm_version TEXT NOT NULL CHECK (length(trim(algorithm_version)) > 0),
              input_hash TEXT NOT NULL CHECK (length(trim(input_hash)) > 0),
              supersedes_week_run_id INTEGER REFERENCES planner_week_runs(id),
              status TEXT NOT NULL CHECK (status IN ('generated','shortfall')),
              shortfall_count INTEGER NOT NULL DEFAULT 0 CHECK (shortfall_count >= 0),
              shortfall_reasons_json TEXT NOT NULL DEFAULT '[]'
                CHECK (json_valid(shortfall_reasons_json)
                  AND json_type(shortfall_reasons_json)='array'),
              generated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              CHECK (supersedes_week_run_id IS NULL OR supersedes_week_run_id != id),
              CHECK (
                (status='generated' AND shortfall_count=0
                  AND json_array_length(shortfall_reasons_json)=0)
                OR (status='shortfall' AND shortfall_count > 0
                  AND json_array_length(shortfall_reasons_json)=shortfall_count)
              )
            );
            """,
            "CREATE UNIQUE INDEX ux_planner_week_runs_id_target ON planner_week_runs(id, target_slug);",
            """
            CREATE TABLE planner_week_slots (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              week_run_id INTEGER NOT NULL,
              target_slug TEXT NOT NULL,
              scheduled_date TEXT NOT NULL CHECK (date(scheduled_date)=scheduled_date),
              position INTEGER NOT NULL CHECK (position >= 1),
              candidate_key TEXT NOT NULL CHECK (length(trim(candidate_key)) > 0),
              topic_target_slug TEXT NOT NULL,
              target_topic_id INTEGER NOT NULL,
              block_kind TEXT NOT NULL CHECK (block_kind IN ('theory','questions','review')),
              duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 45 AND 75),
              planned_questions INTEGER NOT NULL DEFAULT 0 CHECK (planned_questions >= 0),
              score_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(score_json) AND json_type(score_json)='object'),
              evidence_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(evidence_json) AND json_type(evidence_json)='object'),
              state TEXT NOT NULL DEFAULT 'forecast'
                CHECK (state IN ('forecast','materialized','skipped')),
              day_run_id INTEGER REFERENCES planner_runs(id),
              day_block_id INTEGER REFERENCES planner_blocks(id),
              UNIQUE (week_run_id, scheduled_date, position),
              FOREIGN KEY (week_run_id, target_slug)
                REFERENCES planner_week_runs(id, target_slug),
              FOREIGN KEY (topic_target_slug, target_topic_id)
                REFERENCES target_topics(target_slug, id),
              CHECK (
                (block_kind='theory' AND planned_questions=0)
                OR (block_kind IN ('questions','review') AND planned_questions > 0)
              ),
              CHECK (
                (state='materialized' AND day_run_id IS NOT NULL AND day_block_id IS NOT NULL)
                OR (state!='materialized' AND day_run_id IS NULL AND day_block_id IS NULL)
              )
            );
            """,
            "CREATE INDEX idx_learning_events_target_topic_time ON learning_events(target_slug, target_topic_id, occurred_at, id);",
            "CREATE INDEX idx_learning_events_source ON learning_events(source_kind, source_id);",
            "CREATE INDEX idx_topic_learning_states_due ON topic_learning_states(target_slug, next_review_date, stale_at);",
            "CREATE INDEX idx_review_queue_due ON review_queue_items(target_slug, state, due_date, debt_bp DESC);",
            "CREATE UNIQUE INDEX ux_review_queue_open_topic ON review_queue_items(target_slug, target_topic_id) WHERE state IN ('pending','deferred');",
            "CREATE INDEX idx_planner_week_runs_target_week ON planner_week_runs(target_slug, week_start, id);",
            "CREATE INDEX idx_planner_week_slots_date ON planner_week_slots(target_slug, scheduled_date, position);",
        ),
    ),
)

CURRENT_SCHEMA_VERSION = MIGRATIONS[-1][0]


class MigrationRunner:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def migrate(self) -> int:
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                  version INTEGER PRIMARY KEY,
                  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            applied = {
                row[0]
                for row in self.connection.execute(
                    "SELECT version FROM schema_migrations ORDER BY version"
                )
            }
            unsupported = sorted(
                version for version in applied if version > CURRENT_SCHEMA_VERSION
            )
            if unsupported:
                raise UnsupportedSchemaVersionError(
                    "Database schema version "
                    f"{unsupported[-1]} is newer than supported version "
                    f"{CURRENT_SCHEMA_VERSION}"
                )
            for version, statements in MIGRATIONS:
                if version not in applied:
                    for statement in statements:
                        self.connection.execute(statement)
                    self.connection.execute(
                        "INSERT INTO schema_migrations (version) VALUES (?)", (version,)
                    )
                    applied.add(version)
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
        return max(applied, default=0)
