import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('recovery',Path(__file__).parents[1]/'scripts/recover-legacy-timezones.py')
recovery=importlib.util.module_from_spec(spec);spec.loader.exec_module(recovery)


def record(time,index=1775646):
    return {'sourceTime':time,'observedAt':None,'timeStatus':'timezone-unresolved',
            'outages':7,'customers':201,'sourceFormat':'legacy_html',
            'provenance':[{'source':recovery.LATEST_SOURCE,'firstSourceRow':index}]}


class LegacyRecoveryTests(unittest.TestCase):
    def test_overlapping_wall_clocks_use_original_row_provenance(self):
        before=recovery.resolve_total(record('2024-04-28 16:39:29.492621',1775517),{}, {})
        after=recovery.resolve_total(record('2024-04-28 16:39:29.492621',1775667),{}, {})
        self.assertEqual(before['observedAt'],'2024-04-28T16:39:29.492621Z')
        self.assertEqual(after['observedAt'],'2024-04-28T21:39:29.492621Z')

    def test_original_epoch_restores_precision_without_changing_source_string(self):
        raw='2022-12-02 09:31:05'
        epochs={raw:{'first_source_row':'1','epoch_seconds':'1669995065.7261431','blob':'original','filename':'data/2022-12-02_15_31_05.RData'}}
        value=recovery.resolve_total(record(raw,1),epochs,{})
        self.assertEqual(value['observedAt'],'2022-12-02T15:31:05.726143Z')
        self.assertEqual(value['sourceTime'],raw)
        self.assertEqual(value['timeRecovery']['originalEpochSeconds'],'1669995065.7261431')

    def test_epoch_content_row_mismatch_stops_recovery(self):
        raw='2022-12-02 09:31:05'
        with self.assertRaises(ValueError):
            recovery.resolve_total(record(raw,1),{raw:{'first_source_row':'2'}},{})

    def test_unsupported_and_known_missing_records_remain_unresolved(self):
        for raw in [recovery.UNKNOWN_TIME,'2022-02-01 12:00:00']:
            result=recovery.resolve_total(record(raw,10),{}, {})
            self.assertIsNone(result['observedAt'])
            self.assertEqual(result['timeStatus'],'timezone-unresolved')

    def test_ambiguous_fall_back_time_is_not_silently_selected(self):
        value=recovery.resolve_total(record('2024-11-03 01:30:00'),{}, {})
        self.assertIsNone(value['observedAt'])
        self.assertEqual(len(value['timeRecovery']['utcCandidates']),2)

    def test_nonexistent_spring_time_remains_unresolved(self):
        value=recovery.resolve_total(record('2025-03-09 02:30:00'),{}, {})
        self.assertIsNone(value['observedAt'])
        self.assertEqual(value['timeRecovery']['utcCandidates'],[])

    def test_boundary_commit_requires_a_unique_close_clock(self):
        value,zone,lag=recovery.select_commit_zone('2024-04-28 16:01:24.799172','2024-04-28T21:04:20Z')
        self.assertEqual(zone,'America/Chicago')
        self.assertAlmostEqual(lag,175.200828)
        with self.assertRaises(ValueError):
            recovery.select_commit_zone('2024-04-28 16:01:24.799172','2024-04-28T23:04:20Z')


if __name__=='__main__':unittest.main()
