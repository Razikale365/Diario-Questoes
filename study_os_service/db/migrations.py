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
  trust_level INTEGER NOT NULL CHECK (trust_level BETWEEN 0 AND 10),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (course_id, relative_path)
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
            "CREATE INDEX idx_import_runs_root_state ON import_runs(root_id, state);",
            "CREATE INDEX idx_import_issues_root_state ON import_issues(root_id, state);",
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
