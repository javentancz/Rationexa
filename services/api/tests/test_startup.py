from contextlib import ExitStack
from unittest.mock import patch

from fastapi.testclient import TestClient

from rationexa_api import main


def test_serverless_startup_skips_database_maintenance() -> None:
    original = main.settings.startup_database_maintenance
    main.settings.startup_database_maintenance = False
    try:
        with ExitStack() as stack:
            init_db = stack.enter_context(patch.object(main, "init_db"))
            recover = stack.enter_context(patch.object(main.job_manager, "recover_interrupted"))
            with TestClient(main.app, raise_server_exceptions=True):
                pass
        init_db.assert_not_called()
        recover.assert_not_called()
    finally:
        main.settings.startup_database_maintenance = original
