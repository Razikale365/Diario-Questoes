import sqlite3


_MIGRATION_ONE = (
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
)


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
            if 1 not in applied:
                for statement in _MIGRATION_ONE:
                    self.connection.execute(statement)
                self.connection.execute(
                    "INSERT INTO schema_migrations (version) VALUES (?)", (1,)
                )
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
        return 1
