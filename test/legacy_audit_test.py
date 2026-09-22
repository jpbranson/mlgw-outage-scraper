import collections
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('legacy', Path(__file__).parents[1] / 'scripts/audit-legacy-data.py')
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)


class LegacyAuditTests(unittest.TestCase):
    def test_identical_carryover_merges_provenance(self):
        records, identities = {}, collections.defaultdict(set)
        for repo in ['one', 'two', 'three']:
            legacy.add_variant(records, identities, 'capture-a', (3, 25), {'customers': 25}, {'source': repo})
        self.assertEqual(len(records), 1)
        self.assertEqual(len(next(iter(records.values()))['provenance']), 3)

    def test_changed_totals_at_same_time_remain_conflicts(self):
        records, identities = {}, collections.defaultdict(set)
        for customers in [25, 26]:
            legacy.add_variant(records, identities, 'capture-a', (3, customers), {'customers': customers}, {'source': 'repo'})
        self.assertEqual(len(records), 2)
        self.assertEqual(len(identities['capture-a']), 2)

    def test_identical_contents_at_different_times_are_distinct(self):
        records, identities = {}, collections.defaultdict(set)
        for time in ['capture-a', 'capture-b']:
            legacy.add_variant(records, identities, time, (0, 0), {'customers': 0}, {'source': 'repo'})
        self.assertEqual(len(records), 2)

    def test_naive_time_never_receives_invented_offset(self):
        self.assertIsNone(legacy.timestamp('2024-11-03 01:30:00')['observedAt'])
        self.assertIsNone(legacy.timestamp('2024-03-10 02:30:00')['observedAt'])
        self.assertEqual(legacy.timestamp('2022-02-08T22:06:14Z')['observedAt'], '2022-02-08T22:06:14Z')
        with self.assertRaises(ValueError):
            legacy.timestamp('2024-02-30T12:00:00Z')

    def test_capture_wrapper_normalization_preserves_subseconds(self):
        self.assertEqual(legacy.capture_key('./data/2024-04-27_01_16_34.11358.txt'), '2024-04-27_01_16_34.11358')
        self.assertEqual(legacy.capture_key('data/2024-04-27_01_16_34.11358.RData'), '2024-04-27_01_16_34.11358')
        with self.assertRaises(ValueError):
            legacy.capture_key('../../2024-04-27_01_16_34.txt')

    def test_counts_require_complete_supported_values(self):
        self.assertEqual(legacy.count_value('Customers Affected: 117,861', 'Customers Affected: '), 117861)
        for raw in ['unknown', '-1', '', '1foo', '1,23', '1.5']:
            with self.assertRaises(ValueError):
                legacy.count_value(raw)


if __name__ == '__main__':
    unittest.main()
