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
            "ALTER TABLE planner_candidates ADD COLUMN weekly_alignment INTEGER NOT NULL DEFAULT 0 CHECK (weekly_alignment BETWEEN 0 AND 10000);",
            "ALTER TABLE planner_candidates ADD COLUMN adaptation_reason TEXT;",
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
              request_hash TEXT NOT NULL DEFAULT 'legacy'
                CHECK (length(trim(request_hash)) > 0),
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
            """
            CREATE TABLE review_queue_mutations (
              idempotency_key TEXT PRIMARY KEY CHECK (length(trim(idempotency_key)) > 0),
              action_kind TEXT NOT NULL CHECK (action_kind='defer'),
              item_id INTEGER NOT NULL REFERENCES review_queue_items(id),
              request_hash TEXT NOT NULL CHECK (length(trim(request_hash)) > 0),
              result_version INTEGER NOT NULL CHECK (result_version >= 1),
              created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW'))
            );
            """,
            """
            CREATE TABLE learning_import_runs (
              idempotency_key TEXT PRIMARY KEY CHECK (length(trim(idempotency_key)) > 0),
              target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug),
              request_hash TEXT NOT NULL CHECK (length(trim(request_hash)) > 0),
              result_json TEXT NOT NULL
                CHECK (json_valid(result_json) AND json_type(result_json)='object'),
              created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW'))
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
    (
        8,
        (
            """
            CREATE TABLE strategy_sources (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug),
              source_key TEXT NOT NULL CHECK (length(trim(source_key)) > 0),
              source_kind TEXT NOT NULL CHECK (source_kind IN (
                'course','passo','trilha','ls','andrety','tec','manual'
              )),
              display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
              trust_tier INTEGER NOT NULL CHECK (trust_tier BETWEEN 0 AND 10),
              root_id INTEGER REFERENCES course_roots(id),
              material_id INTEGER REFERENCES materials(id),
              external_url TEXT CHECK (
                external_url IS NULL OR external_url GLOB 'http*://*'
              ),
              external_id TEXT,
              edition TEXT NOT NULL DEFAULT '',
              active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
              notes TEXT NOT NULL DEFAULT '',
              version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
              created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              UNIQUE (target_slug, source_key)
            );
            """,
            "CREATE UNIQUE INDEX ux_strategy_sources_id_target ON strategy_sources(id, target_slug);",
            """
            CREATE TABLE strategy_source_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              source_id INTEGER NOT NULL,
              target_slug TEXT NOT NULL,
              discipline TEXT NOT NULL CHECK (length(trim(discipline)) > 0),
              topic_hint TEXT NOT NULL CHECK (length(trim(topic_hint)) > 0),
              source_order INTEGER NOT NULL DEFAULT 0 CHECK (source_order >= 0),
              content_role TEXT NOT NULL CHECK (content_role IN (
                'primary_theory','review_support','question_practice',
                'schedule_advice','incidence_signal'
              )),
              lesson_id INTEGER REFERENCES lessons(id),
              material_id INTEGER REFERENCES materials(id),
              external_url TEXT CHECK (
                external_url IS NULL OR external_url GLOB 'http*://*'
              ),
              external_id TEXT,
              incidence_bp INTEGER NOT NULL DEFAULT 0
                CHECK (incidence_bp BETWEEN 0 AND 10000),
              banca TEXT NOT NULL DEFAULT '',
              provenance_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(provenance_json)
                  AND json_type(provenance_json)='object'),
              source_fingerprint TEXT NOT NULL
                CHECK (length(trim(source_fingerprint)) > 0),
              active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
              version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
              created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              UNIQUE (source_id, source_fingerprint),
              FOREIGN KEY (source_id, target_slug)
                REFERENCES strategy_sources(id, target_slug),
              CHECK (material_id IS NULL OR lesson_id IS NOT NULL),
              CHECK (content_role!='primary_theory' OR material_id IS NOT NULL)
            );
            """,
            "CREATE UNIQUE INDEX ux_strategy_source_items_id_target ON strategy_source_items(id, target_slug);",
            """
            CREATE TABLE topic_source_mappings (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              target_slug TEXT NOT NULL,
              target_topic_id INTEGER NOT NULL,
              source_item_id INTEGER NOT NULL,
              source_target_slug TEXT NOT NULL,
              transfer_kind TEXT NOT NULL CHECK (
                transfer_kind IN ('target_specific','shared','partial')
              ),
              mapping_status TEXT NOT NULL DEFAULT 'proposed'
                CHECK (mapping_status IN ('proposed','approved','rejected')),
              confidence_bp INTEGER NOT NULL DEFAULT 0
                CHECK (confidence_bp BETWEEN 0 AND 10000),
              primary_eligible INTEGER NOT NULL DEFAULT 0
                CHECK (primary_eligible IN (0,1)),
              manual_override INTEGER NOT NULL DEFAULT 0
                CHECK (manual_override IN (0,1)),
              notes TEXT NOT NULL DEFAULT '',
              version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
              created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              UNIQUE (target_slug, target_topic_id, source_item_id),
              FOREIGN KEY (target_slug, target_topic_id)
                REFERENCES target_topics(target_slug, id),
              FOREIGN KEY (source_item_id, source_target_slug)
                REFERENCES strategy_source_items(id, target_slug),
              CHECK (
                transfer_kind!='target_specific' OR source_target_slug=target_slug
              ),
              CHECK (
                primary_eligible=0 OR mapping_status='approved'
              )
            );
            """,
            """
            CREATE TABLE strategy_ingestion_runs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              idempotency_key TEXT NOT NULL UNIQUE
                CHECK (length(trim(idempotency_key)) > 0),
              source_id INTEGER NOT NULL,
              target_slug TEXT NOT NULL,
              input_hash TEXT NOT NULL CHECK (length(trim(input_hash)) > 0),
              algorithm_version TEXT NOT NULL
                CHECK (length(trim(algorithm_version)) > 0),
              status TEXT NOT NULL CHECK (status IN ('completed','failed')),
              discovered_count INTEGER NOT NULL DEFAULT 0
                CHECK (discovered_count >= 0),
              mapped_count INTEGER NOT NULL DEFAULT 0 CHECK (mapped_count >= 0),
              unresolved_count INTEGER NOT NULL DEFAULT 0
                CHECK (unresolved_count >= 0),
              unresolved_report_json TEXT NOT NULL DEFAULT '[]'
                CHECK (json_valid(unresolved_report_json)
                  AND json_type(unresolved_report_json)='array'),
              created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              FOREIGN KEY (source_id, target_slug)
                REFERENCES strategy_sources(id, target_slug),
              CHECK (mapped_count + unresolved_count <= discovered_count),
              CHECK (json_array_length(unresolved_report_json)=unresolved_count)
            );
            """,
            """
            CREATE TABLE source_choice_runs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              idempotency_key TEXT NOT NULL UNIQUE
                CHECK (length(trim(idempotency_key)) > 0),
              target_slug TEXT NOT NULL,
              target_topic_id INTEGER NOT NULL,
              block_kind TEXT NOT NULL CHECK (
                block_kind IN ('theory','questions','review')
              ),
              algorithm_version TEXT NOT NULL
                CHECK (length(trim(algorithm_version)) > 0),
              input_hash TEXT NOT NULL CHECK (length(trim(input_hash)) > 0),
              status TEXT NOT NULL DEFAULT 'chosen'
                CHECK (status IN ('chosen','shortfall')),
              shortfall_reason TEXT,
              created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              FOREIGN KEY (target_slug, target_topic_id)
                REFERENCES target_topics(target_slug, id),
              CHECK (
                (status='chosen' AND shortfall_reason IS NULL)
                OR (status='shortfall' AND length(trim(shortfall_reason)) > 0)
              )
            );
            """,
            "CREATE UNIQUE INDEX ux_source_choice_runs_id_target ON source_choice_runs(id, target_slug);",
            """
            CREATE TABLE source_choice_rows (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              run_id INTEGER NOT NULL,
              target_slug TEXT NOT NULL,
              source_item_id INTEGER NOT NULL REFERENCES strategy_source_items(id),
              target_fit_bp INTEGER NOT NULL CHECK (target_fit_bp BETWEEN 0 AND 10000),
              transfer_confidence_bp INTEGER NOT NULL
                CHECK (transfer_confidence_bp BETWEEN 0 AND 10000),
              trust_bp INTEGER NOT NULL CHECK (trust_bp BETWEEN 0 AND 10000),
              freshness_bp INTEGER NOT NULL CHECK (freshness_bp BETWEEN 0 AND 10000),
              order_readiness_bp INTEGER NOT NULL
                CHECK (order_readiness_bp BETWEEN 0 AND 10000),
              strategy_alignment_bp INTEGER NOT NULL
                CHECK (strategy_alignment_bp BETWEEN 0 AND 10000),
              material_availability_bp INTEGER NOT NULL
                CHECK (material_availability_bp BETWEEN 0 AND 10000),
              low_trust_penalty_bp INTEGER NOT NULL
                CHECK (low_trust_penalty_bp BETWEEN 0 AND 10000),
              mismatch_penalty_bp INTEGER NOT NULL
                CHECK (mismatch_penalty_bp BETWEEN 0 AND 10000),
              final_score INTEGER NOT NULL,
              chosen INTEGER NOT NULL DEFAULT 0 CHECK (chosen IN (0,1)),
              displaced_by_row_id INTEGER REFERENCES source_choice_rows(id),
              stop_reason TEXT,
              evidence_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(evidence_json) AND json_type(evidence_json)='object'),
              UNIQUE (run_id, source_item_id),
              FOREIGN KEY (run_id, target_slug)
                REFERENCES source_choice_runs(id, target_slug),
              CHECK (
                (chosen=1 AND displaced_by_row_id IS NULL AND stop_reason IS NULL)
                OR (chosen=0 AND (
                  (displaced_by_row_id IS NOT NULL AND stop_reason IS NULL)
                  OR (displaced_by_row_id IS NULL AND length(trim(stop_reason)) > 0)
                ))
              ),
              CHECK (displaced_by_row_id IS NULL OR displaced_by_row_id != id)
            );
            """,
            "CREATE UNIQUE INDEX ux_source_choice_one_chosen ON source_choice_rows(run_id) WHERE chosen=1;",
            "CREATE INDEX idx_strategy_sources_target_kind ON strategy_sources(target_slug, source_kind, active);",
            "CREATE INDEX idx_strategy_items_target_order ON strategy_source_items(target_slug, discipline, source_order, id);",
            "CREATE INDEX idx_strategy_mappings_topic ON topic_source_mappings(target_slug, target_topic_id, mapping_status, confidence_bp DESC);",
            "CREATE INDEX idx_strategy_mappings_unresolved ON topic_source_mappings(mapping_status, target_slug, id);",
            "CREATE INDEX idx_source_choice_topic ON source_choice_runs(target_slug, target_topic_id, block_kind, id);",
        ),
    ),
    (
        9,
        (
            """
            ALTER TABLE app_settings ADD COLUMN version INTEGER NOT NULL
              DEFAULT 1 CHECK (version >= 1);
            """,
            """
            CREATE TABLE legacy_migration_runs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              migration_key TEXT NOT NULL UNIQUE
                CHECK (length(trim(migration_key)) > 0),
              schema_name TEXT NOT NULL
                CHECK (length(trim(schema_name)) > 0),
              payload_hash TEXT NOT NULL CHECK (
                length(payload_hash) = 64
                AND payload_hash = lower(payload_hash)
                AND payload_hash NOT GLOB '*[^0-9a-f]*'
              ),
              state TEXT NOT NULL CHECK (
                state IN ('running','completed','failed')
              ),
              stage TEXT NOT NULL CHECK (length(trim(stage)) > 0),
              report_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(report_json)
                  AND json_type(report_json) = 'object'),
              error_code TEXT,
              error_message TEXT,
              version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
              created_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              updated_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              completed_at TEXT,
              CHECK (
                (state = 'running' AND error_code IS NULL
                  AND error_message IS NULL AND completed_at IS NULL)
                OR (state = 'completed' AND error_code IS NULL
                  AND error_message IS NULL AND completed_at IS NOT NULL)
                OR (state = 'failed' AND length(trim(error_code)) > 0
                  AND length(trim(error_message)) > 0
                  AND completed_at IS NULL)
              )
            );
            """,
            """
            CREATE TABLE legacy_id_mappings (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              migration_run_id INTEGER NOT NULL
                REFERENCES legacy_migration_runs(id) ON DELETE RESTRICT,
              record_kind TEXT NOT NULL CHECK (record_kind IN (
                'target_profile','coverage_row','ls_task','source_signal',
                'learning_item','question_metadata'
              )),
              legacy_id TEXT NOT NULL CHECK (length(trim(legacy_id)) > 0),
              target_type TEXT NOT NULL CHECK (length(trim(target_type)) > 0),
              target_ref TEXT NOT NULL CHECK (length(trim(target_ref)) > 0),
              metadata_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(metadata_json)
                  AND json_type(metadata_json) = 'object'),
              created_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              UNIQUE (record_kind, legacy_id)
            );
            """,
            "CREATE INDEX idx_legacy_migration_state ON legacy_migration_runs(state, updated_at, id);",
            "CREATE INDEX idx_legacy_id_run ON legacy_id_mappings(migration_run_id, record_kind, id);",
        ),
    ),
    (
        10,
        (
            """
            UPDATE exam_targets SET
              display_name=CASE
                WHEN display_name IN ('SEFAZ CE', 'SEFAZ CE Auditor Fiscal')
                  THEN 'SEFAZ CE - Auditor Fiscal da Receita Estadual'
                ELSE display_name END,
              institution=CASE
                WHEN institution IN ('SEFAZ CE', 'Secretaria da Fazenda do Ceara')
                  THEN 'Secretaria da Fazenda do Estado do Ceara'
                ELSE institution END,
              role=CASE
                WHEN role='Auditor Fiscal'
                  THEN 'Auditor Fiscal da Receita Estadual - Gestao Fazendaria'
                ELSE role END,
              banca=CASE WHEN banca='CEBRASPE' THEN 'FCC' ELSE banca END,
              deadline=CASE WHEN deadline IS NULL THEN '2026-08-01' ELSE deadline END,
              priority_score=CASE WHEN priority_score=96 THEN 100 ELSE priority_score END,
              source_urls_json=CASE
                WHEN source_urls_json='["https://www.sefaz.ce.gov.br/"]'
                  THEN '["https://www.sefaz.ce.gov.br/wp-content/uploads/sites/61/2026/04/do20260424p02.pdf"]'
                ELSE source_urls_json END,
              notes=CASE
                WHEN notes='Perfil editavel do ciclo em andamento; conferir data e pesos oficiais.'
                  THEN 'Sprint oficial SEFAZ CE 2026. P1 em 01/08; P2 e discursiva em 02/08.'
                ELSE notes END,
              version=version+1,
              updated_at=CURRENT_TIMESTAMP
            WHERE target_slug='sefaz_ce' AND (
              display_name IN ('SEFAZ CE', 'SEFAZ CE Auditor Fiscal')
              OR institution IN ('SEFAZ CE', 'Secretaria da Fazenda do Ceara')
              OR role='Auditor Fiscal' OR banca='CEBRASPE' OR deadline IS NULL
              OR priority_score=96
              OR source_urls_json='["https://www.sefaz.ce.gov.br/"]'
              OR notes='Perfil editavel do ciclo em andamento; conferir data e pesos oficiais.'
            );
            """,
            """
            CREATE TABLE exam_subject_profiles (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              target_slug TEXT NOT NULL
                REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
              subject_key TEXT NOT NULL CHECK (length(trim(subject_key)) > 0),
              display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
              aliases_json TEXT NOT NULL DEFAULT '[]'
                CHECK (json_valid(aliases_json) AND json_type(aliases_json)='array'),
              paper TEXT NOT NULL CHECK (paper IN ('P1','P2')),
              question_count INTEGER NOT NULL CHECK (question_count BETWEEN 1 AND 80),
              question_weight REAL NOT NULL CHECK (question_weight BETWEEN 0.1 AND 10),
              discursive_eligible INTEGER NOT NULL DEFAULT 0
                CHECK (discursive_eligible IN (0,1)),
              baseline_accuracy_bp INTEGER
                CHECK (baseline_accuracy_bp IS NULL OR baseline_accuracy_bp BETWEEN 0 AND 10000),
              target_low_bp INTEGER NOT NULL CHECK (target_low_bp BETWEEN 0 AND 10000),
              target_high_bp INTEGER NOT NULL CHECK (target_high_bp BETWEEN 0 AND 10000),
              baseline_confidence_bp INTEGER NOT NULL DEFAULT 0
                CHECK (baseline_confidence_bp BETWEEN 0 AND 10000),
              focus_band TEXT NOT NULL DEFAULT 'maintenance'
                CHECK (focus_band IN ('focus','maintenance','survival')),
              baseline_source TEXT NOT NULL DEFAULT 'unknown'
                CHECK (length(trim(baseline_source)) > 0),
              notes TEXT NOT NULL DEFAULT '',
              active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
              version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
              created_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              updated_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              UNIQUE (target_slug, subject_key),
              CHECK (target_low_bp <= target_high_bp)
            );
            """,
            """
            CREATE TABLE source_plan_tasks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              target_slug TEXT NOT NULL
                REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
              source_kind TEXT NOT NULL
                CHECK (source_kind IN ('ls','trilha','manual')),
              external_task_id TEXT NOT NULL
                CHECK (length(trim(external_task_id)) > 0),
              plan_label TEXT NOT NULL CHECK (length(trim(plan_label)) > 0),
              meta_number INTEGER CHECK (meta_number IS NULL OR meta_number >= 0),
              scheduled_date TEXT CHECK (
                scheduled_date IS NULL OR
                (length(scheduled_date)=10 AND date(scheduled_date)=scheduled_date)
              ),
              source_order INTEGER NOT NULL DEFAULT 0 CHECK (source_order >= 0),
              discipline TEXT NOT NULL CHECK (length(trim(discipline)) > 0),
              subject_key TEXT,
              topic_hint TEXT NOT NULL DEFAULT '',
              task_kind TEXT NOT NULL CHECK (
                task_kind IN (
                  'theory','questions','review','simulation','discursive','mixed'
                )
              ),
              description TEXT NOT NULL CHECK (length(trim(description)) > 0),
              details TEXT NOT NULL DEFAULT '',
              material_hint TEXT NOT NULL DEFAULT '',
              estimated_minutes INTEGER NOT NULL
                CHECK (estimated_minutes BETWEEN 1 AND 720),
              spent_minutes INTEGER NOT NULL DEFAULT 0
                CHECK (spent_minutes BETWEEN 0 AND 720),
              relevance REAL NOT NULL DEFAULT 5 CHECK (relevance BETWEEN 0 AND 10),
              status TEXT NOT NULL DEFAULT 'pending' CHECK (
                status IN ('pending','started','completed','ignored','archived')
              ),
              performance_bp INTEGER
                CHECK (performance_bp IS NULL OR performance_bp BETWEEN 0 AND 10000),
              linked_study_task_id TEXT,
              provenance_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(provenance_json) AND json_type(provenance_json)='object'),
              imported_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              updated_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
              UNIQUE (target_slug, source_kind, external_task_id),
              CHECK (subject_key IS NULL OR length(trim(subject_key)) > 0)
            );
            """,
            """
            CREATE TABLE exam_sprint_configs (
              target_slug TEXT PRIMARY KEY
                REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
              start_date TEXT NOT NULL
                CHECK (length(start_date)=10 AND date(start_date)=start_date),
              objective_date TEXT NOT NULL
                CHECK (length(objective_date)=10 AND date(objective_date)=objective_date),
              exam_end_date TEXT NOT NULL
                CHECK (length(exam_end_date)=10 AND date(exam_end_date)=exam_end_date),
              ls_budget_minutes INTEGER NOT NULL DEFAULT 240
                CHECK (ls_budget_minutes BETWEEN 15 AND 720),
              extra_budget_minutes INTEGER NOT NULL DEFAULT 60
                CHECK (extra_budget_minutes BETWEEN 0 AND 240),
              p1_floor_questions INTEGER NOT NULL DEFAULT 48
                CHECK (p1_floor_questions BETWEEN 0 AND 80),
              p1_goal_low INTEGER NOT NULL CHECK (p1_goal_low BETWEEN 0 AND 80),
              p1_goal_high INTEGER NOT NULL CHECK (p1_goal_high BETWEEN 0 AND 80),
              p2_goal_low INTEGER NOT NULL CHECK (p2_goal_low BETWEEN 0 AND 80),
              p2_goal_high INTEGER NOT NULL CHECK (p2_goal_high BETWEEN 0 AND 80),
              discursive_goal_low INTEGER NOT NULL
                CHECK (discursive_goal_low BETWEEN 0 AND 100),
              discursive_goal_high INTEGER NOT NULL
                CHECK (discursive_goal_high BETWEEN 0 AND 100),
              triage_mode TEXT NOT NULL DEFAULT 'suggest_only'
                CHECK (triage_mode='suggest_only'),
              state TEXT NOT NULL DEFAULT 'active'
                CHECK (state IN ('active','paused','completed')),
              version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
              created_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              updated_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              CHECK (start_date <= objective_date AND objective_date <= exam_end_date),
              CHECK (p1_goal_low <= p1_goal_high),
              CHECK (p2_goal_low <= p2_goal_high),
              CHECK (discursive_goal_low <= discursive_goal_high)
            );
            """,
            """
            CREATE TABLE sprint_day_runs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              idempotency_key TEXT NOT NULL UNIQUE
                CHECK (length(trim(idempotency_key)) > 0),
              target_slug TEXT NOT NULL
                REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
              plan_date TEXT NOT NULL
                CHECK (length(plan_date)=10 AND date(plan_date)=plan_date),
              days_remaining INTEGER NOT NULL CHECK (days_remaining >= 0),
              ls_budget_minutes INTEGER NOT NULL
                CHECK (ls_budget_minutes BETWEEN 15 AND 720),
              extra_budget_minutes INTEGER NOT NULL
                CHECK (extra_budget_minutes BETWEEN 0 AND 240),
              energy_level INTEGER NOT NULL DEFAULT 3 CHECK (energy_level BETWEEN 1 AND 5),
              algorithm_version TEXT NOT NULL
                CHECK (length(trim(algorithm_version)) > 0),
              input_hash TEXT NOT NULL CHECK (length(trim(input_hash)) > 0),
              supersedes_run_id INTEGER
                REFERENCES sprint_day_runs(id) ON DELETE RESTRICT,
              status TEXT NOT NULL CHECK (status IN ('generated','shortfall')),
              score_snapshot_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(score_snapshot_json) AND json_type(score_snapshot_json)='object'),
              generated_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW'))
            );
            """,
            """
            CREATE TABLE sprint_actions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              run_id INTEGER NOT NULL
                REFERENCES sprint_day_runs(id) ON DELETE RESTRICT,
              target_slug TEXT NOT NULL
                REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
              position INTEGER NOT NULL CHECK (position > 0),
              action_kind TEXT NOT NULL CHECK (action_kind IN (
                'ls_execute','ls_compress','ls_defer','microblock','review',
                'simulation','discursive','minimum_viable'
              )),
              recommendation TEXT NOT NULL
                CHECK (recommendation IN ('execute','compress','defer','extra')),
              source_plan_task_id INTEGER
                REFERENCES source_plan_tasks(id) ON DELETE RESTRICT,
              subject_profile_id INTEGER
                REFERENCES exam_subject_profiles(id) ON DELETE RESTRICT,
              topic_hint TEXT NOT NULL DEFAULT '',
              title TEXT NOT NULL CHECK (length(trim(title)) > 0),
              duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 5 AND 240),
              planned_questions INTEGER NOT NULL DEFAULT 0 CHECK (planned_questions >= 0),
              expected_gain_milli INTEGER NOT NULL DEFAULT 0 CHECK (expected_gain_milli >= 0),
              confidence_bp INTEGER NOT NULL DEFAULT 0
                CHECK (confidence_bp BETWEEN 0 AND 10000),
              rationale_json TEXT NOT NULL DEFAULT '[]'
                CHECK (json_valid(rationale_json) AND json_type(rationale_json)='array'),
              evidence_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(evidence_json) AND json_type(evidence_json)='object'),
              decision TEXT NOT NULL DEFAULT 'pending'
                CHECK (decision IN ('pending','accepted','rejected')),
              state TEXT NOT NULL DEFAULT 'pending'
                CHECK (state IN ('pending','active','completed','skipped','failed')),
              actual_minutes INTEGER CHECK (actual_minutes IS NULL OR actual_minutes BETWEEN 0 AND 720),
              questions_done INTEGER NOT NULL DEFAULT 0 CHECK (questions_done >= 0),
              correct_count INTEGER NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
              wrong_count INTEGER NOT NULL DEFAULT 0 CHECK (wrong_count >= 0),
              doubt_count INTEGER NOT NULL DEFAULT 0 CHECK (doubt_count >= 0),
              energy_after INTEGER CHECK (energy_after IS NULL OR energy_after BETWEEN 1 AND 5),
              version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
              created_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              updated_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              UNIQUE (run_id, position),
              CHECK (source_plan_task_id IS NOT NULL OR subject_profile_id IS NOT NULL),
              CHECK (correct_count + wrong_count <= questions_done),
              CHECK (doubt_count <= questions_done),
              CHECK (
                (recommendation='execute' AND action_kind IN ('ls_execute','simulation')) OR
                (recommendation='compress' AND action_kind='ls_compress') OR
                (recommendation='defer' AND action_kind='ls_defer') OR
                (recommendation='extra' AND action_kind IN (
                  'microblock','review','simulation','discursive','minimum_viable'
                ))
              )
            );
            """,
            """
            CREATE TABLE sprint_action_question_refs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              action_id INTEGER NOT NULL
                REFERENCES sprint_actions(id) ON DELETE RESTRICT,
              question_fingerprint TEXT NOT NULL
                CHECK (length(trim(question_fingerprint)) > 0),
              source_task_id TEXT,
              reason TEXT NOT NULL CHECK (reason IN ('wrong','doubt','favorite')),
              created_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              UNIQUE (action_id, question_fingerprint)
            );
            """,
            """
            CREATE TABLE sprint_mutation_receipts (
              idempotency_key TEXT PRIMARY KEY
                CHECK (length(trim(idempotency_key)) > 0),
              mutation_kind TEXT NOT NULL CHECK (length(trim(mutation_kind)) > 0),
              target_slug TEXT NOT NULL
                REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
              entity_ref TEXT NOT NULL DEFAULT '',
              payload_hash TEXT NOT NULL CHECK (
                length(payload_hash)=64
                AND payload_hash=lower(payload_hash)
                AND payload_hash NOT GLOB '*[^0-9a-f]*'
              ),
              response_json TEXT NOT NULL
                CHECK (json_valid(response_json) AND json_type(response_json)='object'),
              created_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW'))
            );
            """,
            "CREATE INDEX idx_subject_profiles_target_paper ON exam_subject_profiles(target_slug, paper, active);",
            "CREATE INDEX idx_source_plan_target_date ON source_plan_tasks(target_slug, scheduled_date, status, source_order);",
            "CREATE INDEX idx_source_plan_unmatched ON source_plan_tasks(target_slug, subject_key, status) WHERE subject_key IS NULL;",
            "CREATE INDEX idx_sprint_runs_target_date ON sprint_day_runs(target_slug, plan_date, id DESC);",
            "CREATE INDEX idx_sprint_actions_run_state ON sprint_actions(run_id, state, position);",
            "CREATE INDEX idx_sprint_question_refs_reason ON sprint_action_question_refs(reason, action_id);",
            "CREATE INDEX idx_sprint_receipts_target_kind ON sprint_mutation_receipts(target_slug, mutation_kind, created_at);",
        ),
    ),
    (
        11,
        (
            """
            CREATE TABLE sprint_evidence_import_batches (
              batch_id TEXT PRIMARY KEY CHECK (length(trim(batch_id)) > 0),
              target_slug TEXT NOT NULL
                REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
              origin TEXT NOT NULL CHECK (length(trim(origin)) > 0),
              payload_hash TEXT NOT NULL CHECK (
                length(payload_hash)=64
                AND payload_hash=lower(payload_hash)
                AND payload_hash NOT GLOB '*[^0-9a-f]*'
              ),
              item_count INTEGER NOT NULL CHECK (item_count >= 0),
              inserted_count INTEGER NOT NULL CHECK (inserted_count >= 0),
              duplicate_count INTEGER NOT NULL CHECK (duplicate_count >= 0),
              conflict_count INTEGER NOT NULL CHECK (conflict_count >= 0),
              report_json TEXT NOT NULL CHECK (
                json_valid(report_json) AND json_type(report_json)='object'
              ),
              imported_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              UNIQUE (batch_id, target_slug, origin)
            );
            """,
            """
            CREATE TABLE sprint_performance_observations (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              target_slug TEXT NOT NULL
                REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
              batch_id TEXT NOT NULL,
              subject_profile_id INTEGER
                REFERENCES exam_subject_profiles(id) ON DELETE RESTRICT,
              subject_key TEXT,
              discipline TEXT NOT NULL CHECK (length(trim(discipline)) > 0),
              topic_hint TEXT NOT NULL DEFAULT '',
              observed_on TEXT NOT NULL CHECK (
                length(observed_on)=10 AND date(observed_on)=observed_on
              ),
              origin TEXT NOT NULL CHECK (length(trim(origin)) > 0),
              source_record_id TEXT NOT NULL
                CHECK (length(trim(source_record_id)) > 0),
              source_revision TEXT NOT NULL
                CHECK (length(trim(source_revision)) > 0),
              source_updated_at TEXT NOT NULL CHECK (
                length(source_updated_at)=27
                AND source_updated_at GLOB
                  '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9][0-9][0-9][0-9]Z'
                AND CAST(substr(source_updated_at, 1, 4) AS INTEGER)
                  BETWEEN 1 AND 9999
                AND CAST(substr(source_updated_at, 12, 2) AS INTEGER)
                  BETWEEN 0 AND 23
                AND date(source_updated_at) IS NOT NULL
                AND date(source_updated_at)=substr(source_updated_at, 1, 10)
                AND time(source_updated_at) IS NOT NULL
                AND time(source_updated_at)=substr(source_updated_at, 12, 8)
              ),
              measurement_type TEXT NOT NULL CHECK (measurement_type IN (
                'full_exam','sectional_mock','unseen_set','mixed_set',
                'error_review','ls_percentage','sprint_action','baseline'
              )),
              exam_board TEXT NOT NULL DEFAULT '',
              correct_count INTEGER
                CHECK (correct_count IS NULL OR correct_count >= 0),
              wrong_count INTEGER
                CHECK (wrong_count IS NULL OR wrong_count >= 0),
              doubt_count INTEGER NOT NULL DEFAULT 0 CHECK (doubt_count >= 0),
              percentage_bp INTEGER NOT NULL CHECK (percentage_bp BETWEEN 0 AND 10000),
              transfer_scope TEXT NOT NULL DEFAULT 'content' CHECK (
                transfer_scope IN ('content','method','trap_pattern')
              ),
              transferability_bp INTEGER NOT NULL DEFAULT 10000
                CHECK (transferability_bp BETWEEN 0 AND 10000),
              content_hash TEXT NOT NULL CHECK (
                length(content_hash)=64
                AND content_hash=lower(content_hash)
                AND content_hash NOT GLOB '*[^0-9a-f]*'
              ),
              provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (
                json_valid(provenance_json) AND json_type(provenance_json)='object'
              ),
              created_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              UNIQUE (target_slug, origin, source_record_id, source_revision),
              FOREIGN KEY (batch_id, target_slug, origin)
                REFERENCES sprint_evidence_import_batches(
                  batch_id, target_slug, origin
                ) ON DELETE RESTRICT,
              CHECK ((correct_count IS NULL) = (wrong_count IS NULL)),
              CHECK (correct_count IS NULL OR correct_count + wrong_count > 0),
              CHECK (
                correct_count IS NULL OR
                percentage_bp = ROUND(
                  10000.0 * correct_count / (correct_count + wrong_count)
                )
              ),
              CHECK (
                correct_count IS NULL OR
                doubt_count <= correct_count + wrong_count
              ),
              CHECK (subject_key IS NULL OR length(trim(subject_key)) > 0)
            );
            """,
            """
            CREATE TABLE source_plan_cycles (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              target_slug TEXT NOT NULL
                REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
              source_kind TEXT NOT NULL CHECK (source_kind IN ('ls','trilha','manual')),
              plan_label TEXT NOT NULL CHECK (length(trim(plan_label)) > 0),
              meta_number INTEGER CHECK (meta_number IS NULL OR meta_number >= 0),
              released_at TEXT NOT NULL CHECK (
                length(released_at)=27
                AND released_at GLOB
                  '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9][0-9][0-9][0-9]Z'
                AND CAST(substr(released_at, 1, 4) AS INTEGER)
                  BETWEEN 1 AND 9999
                AND CAST(substr(released_at, 12, 2) AS INTEGER)
                  BETWEEN 0 AND 23
                AND date(released_at) IS NOT NULL
                AND date(released_at)=substr(released_at, 1, 10)
                AND time(released_at) IS NOT NULL
                AND time(released_at)=substr(released_at, 12, 8)
              ),
              starts_on TEXT NOT NULL CHECK (
                length(starts_on)=10 AND date(starts_on)=starts_on
              ),
              ends_on TEXT NOT NULL CHECK (
                length(ends_on)=10 AND date(ends_on)=ends_on
              ),
              version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
              imported_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              updated_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              UNIQUE (target_slug, source_kind, plan_label),
              UNIQUE (id, target_slug),
              CHECK (starts_on <= ends_on),
              CHECK (date(released_at) <= ends_on)
            );
            """,
            """
            ALTER TABLE source_plan_tasks ADD COLUMN source_cycle_id INTEGER
              REFERENCES source_plan_cycles(id) ON DELETE RESTRICT;
            """,
            """
            CREATE UNIQUE INDEX uq_source_plan_tasks_cycle_target
              ON source_plan_tasks(id, source_cycle_id, target_slug);
            """,
            """
            CREATE TRIGGER trg_source_plan_tasks_cycle_target_insert
            BEFORE INSERT ON source_plan_tasks
            WHEN NEW.source_cycle_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM source_plan_cycles
                WHERE id=NEW.source_cycle_id
                  AND target_slug=NEW.target_slug
              )
            BEGIN
              SELECT RAISE(ABORT, 'source plan cycle target mismatch');
            END;
            """,
            """
            CREATE TRIGGER trg_source_plan_tasks_cycle_target_update
            BEFORE UPDATE OF source_cycle_id, target_slug ON source_plan_tasks
            WHEN NEW.source_cycle_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM source_plan_cycles
                WHERE id=NEW.source_cycle_id
                  AND target_slug=NEW.target_slug
              )
            BEGIN
              SELECT RAISE(ABORT, 'source plan cycle target mismatch');
            END;
            """,
            """
            CREATE TRIGGER trg_source_plan_cycles_target_update
            BEFORE UPDATE OF target_slug ON source_plan_cycles
            WHEN EXISTS (
              SELECT 1 FROM source_plan_tasks
              WHERE source_cycle_id=OLD.id
                AND target_slug<>NEW.target_slug
            )
            BEGIN
              SELECT RAISE(ABORT, 'source plan cycle target mismatch');
            END;
            """,
            """
            CREATE TABLE source_plan_backlog_candidates (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              target_slug TEXT NOT NULL
                REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
              source_cycle_id INTEGER NOT NULL,
              source_plan_task_id INTEGER NOT NULL UNIQUE,
              reason TEXT NOT NULL CHECK (reason='cycle_closed_pending'),
              return_score_milli INTEGER NOT NULL CHECK (return_score_milli >= 0),
              state TEXT NOT NULL DEFAULT 'candidate' CHECK (
                state IN ('candidate','recovered','dismissed')
              ),
              discovered_on TEXT NOT NULL CHECK (
                length(discovered_on)=10 AND date(discovered_on)=discovered_on
              ),
              recovered_on TEXT CHECK (
                recovered_on IS NULL OR
                (length(recovered_on)=10 AND date(recovered_on)=recovered_on)
              ),
              created_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              updated_at TEXT NOT NULL DEFAULT
                (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              FOREIGN KEY (source_cycle_id, target_slug)
                REFERENCES source_plan_cycles(id, target_slug)
                ON DELETE RESTRICT,
              FOREIGN KEY (
                source_plan_task_id, source_cycle_id, target_slug
              ) REFERENCES source_plan_tasks(
                id, source_cycle_id, target_slug
              ) ON DELETE RESTRICT,
              CHECK (
                (state='recovered' AND recovered_on IS NOT NULL) OR
                (state!='recovered' AND recovered_on IS NULL)
              )
            );
            """,
            """
            UPDATE exam_sprint_configs
            SET p1_goal_high=64,
                p2_goal_high=70,
                version=version+1,
                updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')
            WHERE target_slug='sefaz_ce'
              AND p1_floor_questions=48
              AND p1_goal_low=48
              AND p1_goal_high=52
              AND p2_goal_low=63
              AND p2_goal_high=67;
            """,
            """
            CREATE INDEX idx_sprint_evidence_latest
              ON sprint_performance_observations(
                target_slug, origin, source_record_id,
                source_updated_at DESC, id DESC
              );
            """,
            """
            CREATE INDEX idx_sprint_evidence_subject_date
              ON sprint_performance_observations(
                target_slug, subject_key, observed_on DESC, id DESC
              );
            """,
            """
            CREATE INDEX idx_source_plan_cycle_date
              ON source_plan_cycles(target_slug, starts_on, ends_on, id);
            """,
            """
            CREATE INDEX idx_source_plan_tasks_cycle
              ON source_plan_tasks(source_cycle_id, status, source_order);
            """,
            """
            CREATE INDEX idx_source_plan_backlog_state
              ON source_plan_backlog_candidates(target_slug, state, return_score_milli DESC, id);
            """,
        ),
    ),
    (
        12,
        (
            """
            CREATE TABLE sprint_calendar_runs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              idempotency_key TEXT NOT NULL UNIQUE,
              target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
              window_start TEXT NOT NULL CHECK (date(window_start)=window_start),
              window_end TEXT NOT NULL CHECK (date(window_end)=window_end),
              planning_cutoff TEXT NOT NULL,
              exact_through TEXT NOT NULL CHECK (date(exact_through)=exact_through),
              algorithm_version TEXT NOT NULL,
              request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
              input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
              base_applied_run_id INTEGER,
              supersedes_run_id INTEGER,
              decision TEXT NOT NULL CHECK (decision IN ('draft','applied','rejected')),
              status TEXT NOT NULL CHECK (status IN ('generated','shortfall')),
              warnings_json TEXT NOT NULL CHECK (json_valid(warnings_json) AND json_type(warnings_json)='array'),
              shortfalls_json TEXT NOT NULL CHECK (json_valid(shortfalls_json) AND json_type(shortfalls_json)='array'),
              projection_snapshot_json TEXT NOT NULL CHECK (json_valid(projection_snapshot_json)),
              capacity_snapshot_json TEXT NOT NULL CHECK (json_valid(capacity_snapshot_json)),
              version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
              generated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              applied_at TEXT,
              UNIQUE (id, target_slug),
              CHECK (window_start <= window_end),
              CHECK (julianday(window_end)-julianday(window_start) BETWEEN 0 AND 14),
              CHECK (supersedes_run_id IS NULL OR supersedes_run_id != id),
              CHECK (
                (decision='applied' AND applied_at IS NOT NULL) OR
                (decision!='applied' AND applied_at IS NULL)
              ),
              FOREIGN KEY (base_applied_run_id, target_slug)
                REFERENCES sprint_calendar_runs(id, target_slug) ON DELETE RESTRICT,
              FOREIGN KEY (supersedes_run_id, target_slug)
                REFERENCES sprint_calendar_runs(id, target_slug) ON DELETE RESTRICT
            );
            """,
            """
            CREATE UNIQUE INDEX uq_sprint_calendar_supersedes
            ON sprint_calendar_runs(supersedes_run_id)
            WHERE supersedes_run_id IS NOT NULL;
            """,
            """
            CREATE INDEX idx_sprint_calendar_runs_head
            ON sprint_calendar_runs(target_slug, decision, id DESC);
            """,
            """
            CREATE UNIQUE INDEX uq_source_plan_tasks_id_target
            ON source_plan_tasks(id, target_slug);
            """,
            """
            CREATE UNIQUE INDEX uq_exam_subject_profiles_id_target
            ON exam_subject_profiles(id, target_slug);
            """,
            """
            CREATE UNIQUE INDEX uq_sprint_day_runs_id_target
            ON sprint_day_runs(id, target_slug);
            """,
            """
            CREATE UNIQUE INDEX uq_sprint_actions_id_run_target
            ON sprint_actions(id, run_id, target_slug);
            """,
            """
            CREATE TABLE sprint_calendar_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
              item_key TEXT NOT NULL,
              origin TEXT NOT NULL CHECK (origin IN ('source','manual','system')),
              kind TEXT NOT NULL CHECK (kind IN ('source_task','manual','intervention','future_cycle_capacity')),
              source_plan_task_id INTEGER,
              subject_profile_id INTEGER,
              title TEXT NOT NULL,
              expected_meta_number INTEGER CHECK (expected_meta_number IS NULL OR expected_meta_number >= 0),
              state TEXT NOT NULL CHECK (state IN ('pending','active','completed','failed','ignored','archived')),
              result_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(result_json) AND json_type(result_json)='object'),
              completed_at TEXT,
              version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
              created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              UNIQUE (id, target_slug),
              UNIQUE (target_slug, item_key),
              UNIQUE (target_slug, source_plan_task_id),
              CHECK (kind!='source_task' OR (origin='source' AND source_plan_task_id IS NOT NULL)),
              CHECK (
                kind!='future_cycle_capacity' OR (
                  origin='system' AND source_plan_task_id IS NULL AND
                  subject_profile_id IS NULL AND state='pending' AND
                  result_json='{}' AND completed_at IS NULL
                )
              ),
              FOREIGN KEY (source_plan_task_id, target_slug)
                REFERENCES source_plan_tasks(id, target_slug) ON DELETE RESTRICT,
              FOREIGN KEY (subject_profile_id, target_slug)
                REFERENCES exam_subject_profiles(id, target_slug) ON DELETE RESTRICT
            );
            """,
            """
            CREATE TABLE sprint_calendar_days (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              run_id INTEGER NOT NULL,
              target_slug TEXT NOT NULL,
              plan_date TEXT NOT NULL CHECK (date(plan_date)=plan_date),
              precision TEXT NOT NULL CHECK (precision IN ('exact','provisional','protected')),
              availability_source TEXT NOT NULL CHECK (
                availability_source IN ('manual_date','manual_weekday','manual_global','learned','default')
              ),
              available INTEGER NOT NULL CHECK (available IN (0,1)),
              available_minutes INTEGER NOT NULL CHECK (available_minutes BETWEEN 0 AND 960),
              ls_minutes INTEGER NOT NULL CHECK (ls_minutes BETWEEN 0 AND 720),
              extra_minutes INTEGER NOT NULL CHECK (extra_minutes BETWEEN 0 AND 240),
              reserved_minutes INTEGER NOT NULL CHECK (reserved_minutes >= 0),
              overage_minutes INTEGER NOT NULL CHECK (overage_minutes >= 0),
              energy_level INTEGER NOT NULL CHECK (energy_level BETWEEN 1 AND 5),
              confidence_bp INTEGER NOT NULL CHECK (confidence_bp BETWEEN 0 AND 10000),
              warnings_json TEXT NOT NULL DEFAULT '[]'
                CHECK (json_valid(warnings_json) AND json_type(warnings_json)='array'),
              UNIQUE (run_id, plan_date),
              CHECK (available_minutes = ls_minutes + extra_minutes),
              CHECK (
                (available=0 AND available_minutes=0) OR
                (available=1 AND available_minutes>0)
              ),
              CHECK (overage_minutes = MAX(reserved_minutes - available_minutes, 0)),
              FOREIGN KEY (run_id, target_slug)
                REFERENCES sprint_calendar_runs(id, target_slug) ON DELETE RESTRICT
            );
            """,
            """
            CREATE TABLE sprint_calendar_assignments (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              run_id INTEGER NOT NULL,
              target_slug TEXT NOT NULL,
              item_id INTEGER NOT NULL,
              plan_date TEXT NOT NULL CHECK (date(plan_date)=plan_date),
              position INTEGER NOT NULL CHECK (position > 0),
              duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 720),
              precision TEXT NOT NULL CHECK (precision IN ('exact','provisional','protected')),
              priority_tier TEXT NOT NULL CHECK (priority_tier IN ('critical','high','maintenance','protected')),
              reason_json TEXT NOT NULL DEFAULT '[]'
                CHECK (json_valid(reason_json) AND json_type(reason_json)='array'),
              pinned_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (pinned_snapshot IN (0,1)),
              action_json TEXT CHECK (
                action_json IS NULL OR (json_valid(action_json) AND json_type(action_json)='object')
              ),
              expected_gain_milli INTEGER NOT NULL DEFAULT 0 CHECK (expected_gain_milli >= 0),
              replaces_placeholder_item_id INTEGER,
              UNIQUE (id, target_slug),
              UNIQUE (run_id, item_id),
              UNIQUE (run_id, plan_date, position),
              CHECK (replaces_placeholder_item_id IS NULL OR replaces_placeholder_item_id != item_id),
              FOREIGN KEY (run_id, target_slug)
                REFERENCES sprint_calendar_runs(id, target_slug) ON DELETE RESTRICT,
              FOREIGN KEY (run_id, plan_date)
                REFERENCES sprint_calendar_days(run_id, plan_date) ON DELETE RESTRICT,
              FOREIGN KEY (item_id, target_slug)
                REFERENCES sprint_calendar_items(id, target_slug) ON DELETE RESTRICT,
              FOREIGN KEY (replaces_placeholder_item_id, target_slug)
                REFERENCES sprint_calendar_items(id, target_slug) ON DELETE RESTRICT
            );
            """,
            """
            CREATE TRIGGER trg_sprint_calendar_placeholder_assignment_insert
            BEFORE INSERT ON sprint_calendar_assignments
            WHEN EXISTS (
              SELECT 1 FROM sprint_calendar_items AS item
              WHERE item.id=NEW.item_id AND item.target_slug=NEW.target_slug
                AND item.kind='future_cycle_capacity'
            ) AND (NEW.action_json IS NOT NULL OR NEW.expected_gain_milli != 0)
            BEGIN
              SELECT RAISE(ABORT, 'future cycle capacity cannot be executable');
            END;
            """,
            """
            CREATE TABLE sprint_calendar_materializations (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              target_slug TEXT NOT NULL,
              assignment_id INTEGER NOT NULL,
              sprint_day_run_id INTEGER NOT NULL,
              sprint_action_id INTEGER NOT NULL,
              created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              UNIQUE (assignment_id),
              UNIQUE (sprint_action_id),
              FOREIGN KEY (assignment_id, target_slug)
                REFERENCES sprint_calendar_assignments(id, target_slug) ON DELETE RESTRICT,
              FOREIGN KEY (sprint_day_run_id, target_slug)
                REFERENCES sprint_day_runs(id, target_slug) ON DELETE RESTRICT,
              FOREIGN KEY (sprint_action_id, sprint_day_run_id, target_slug)
                REFERENCES sprint_actions(id, run_id, target_slug) ON DELETE RESTRICT
            );
            """,
            """
            CREATE TABLE sprint_calendar_day_overrides (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              target_slug TEXT NOT NULL REFERENCES exam_targets(target_slug) ON DELETE RESTRICT,
              scope_kind TEXT NOT NULL CHECK (scope_kind IN ('date','weekday','global')),
              scope_value TEXT NOT NULL,
              availability TEXT NOT NULL CHECK (availability IN ('default','available','unavailable')),
              ls_minutes INTEGER CHECK (ls_minutes IS NULL OR ls_minutes BETWEEN 0 AND 720),
              extra_minutes INTEGER CHECK (extra_minutes IS NULL OR extra_minutes BETWEEN 0 AND 240),
              energy_level INTEGER CHECK (energy_level IS NULL OR energy_level BETWEEN 1 AND 5),
              active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
              version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
              created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              CHECK (
                (scope_kind='date' AND date(scope_value)=scope_value) OR
                (scope_kind='weekday' AND scope_value IN ('0','1','2','3','4','5','6')) OR
                (scope_kind='global' AND scope_value='*')
              ),
              CHECK (
                (availability='unavailable' AND ls_minutes=0 AND extra_minutes=0) OR
                (availability!='unavailable' AND
                  (ls_minutes IS NULL OR ls_minutes BETWEEN 1 AND 720) AND
                  (extra_minutes IS NULL OR extra_minutes BETWEEN 0 AND 240))
              )
            );
            """,
            """
            CREATE UNIQUE INDEX uq_sprint_calendar_active_day_override
            ON sprint_calendar_day_overrides(target_slug, scope_kind, scope_value)
            WHERE active=1;
            """,
            """
            CREATE TABLE sprint_calendar_item_overrides (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              target_slug TEXT NOT NULL,
              item_id INTEGER NOT NULL,
              plan_date TEXT NOT NULL CHECK (date(plan_date)=plan_date),
              start_time TEXT CHECK (
                start_time IS NULL OR
                (length(start_time)=5 AND time(start_time)=start_time || ':00')
              ),
              position INTEGER CHECK (position IS NULL OR position > 0),
              duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 720),
              pinned INTEGER NOT NULL DEFAULT 1 CHECK (pinned IN (0,1)),
              active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
              version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
              created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')),
              CHECK (active=0 OR pinned=1),
              FOREIGN KEY (item_id, target_slug)
                REFERENCES sprint_calendar_items(id, target_slug) ON DELETE RESTRICT
            );
            """,
            """
            CREATE UNIQUE INDEX uq_sprint_calendar_active_item_override
            ON sprint_calendar_item_overrides(target_slug, item_id)
            WHERE active=1;
            """,
            """
            CREATE INDEX idx_sprint_calendar_days_target_date
            ON sprint_calendar_days(target_slug, plan_date, run_id);
            """,
            """
            CREATE INDEX idx_sprint_calendar_assignments_date_position
            ON sprint_calendar_assignments(target_slug, plan_date, position);
            """,
            """
            CREATE INDEX idx_sprint_calendar_items_state
            ON sprint_calendar_items(target_slug, state, updated_at);
            """,
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
