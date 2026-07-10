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
