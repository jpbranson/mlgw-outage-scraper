import datetime as dt
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('timestamps', Path(__file__).parents[1] / 'scripts/audit-legacy-timestamps.py')
timestamps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(timestamps)


class LegacyTimestampTests(unittest.TestCase):
    def test_utc_and_central_use_different_seasonal_offsets(self):
        for raw, offset in [('2024-07-01 12:00:00', 5), ('2025-01-01 12:00:00', 6)]:
            utc = timestamps.utc_candidates(raw, dt.timezone.utc)[0]
            central = timestamps.utc_candidates(raw, timestamps.CENTRAL)[0]
            self.assertEqual((central - utc).total_seconds(), offset * 3600)

    def test_dst_fold_returns_both_instants_and_gap_returns_none(self):
        candidates = timestamps.utc_candidates('2024-11-03 01:30:00', timestamps.CENTRAL)
        self.assertEqual(len(candidates), 2)
        self.assertEqual((candidates[1] - candidates[0]).total_seconds(), 3600)
        self.assertEqual(timestamps.utc_candidates('2024-03-10 02:30:00', timestamps.CENTRAL), [])

    def test_commit_anchor_can_resolve_a_fold(self):
        c = timestamps.close_commit_candidates('2024-11-03 01:30:00', dt.datetime(2024,11,3,7,30,10,tzinfo=dt.timezone.utc))
        self.assertEqual(len(c), 1)
        self.assertEqual(c[0]['utc'], '2024-11-03T07:30:00Z')

    def test_stale_or_future_capture_is_not_forced_into_a_zone(self):
        self.assertEqual(timestamps.close_commit_candidates('2024-07-01 12:00:00', dt.datetime(2024,7,2,tzinfo=dt.timezone.utc)), [])
        self.assertEqual(timestamps.close_commit_candidates('2024-07-01 12:00:00', dt.datetime(2024,7,1,11,59,tzinfo=dt.timezone.utc)), [])

    def test_original_epoch_does_not_depend_on_host_timezone(self):
        actual = timestamps.epoch_time('1669995065.726143')
        self.assertEqual(actual.isoformat(), '2022-12-02T15:31:05.726143+00:00')
        self.assertEqual(actual.astimezone(timestamps.CENTRAL).strftime('%Y-%m-%d %H:%M:%S'), '2022-12-02 09:31:05')


if __name__ == '__main__':
    unittest.main()
