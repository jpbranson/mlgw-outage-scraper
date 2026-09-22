import datetime as dt
import importlib.util
from pathlib import Path
import unittest


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1]/'scripts'/filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


audit = load('coverage_audit', 'audit-legacy-coverage.py')
verify = load('coverage_verify', 'verify-legacy-coverage.py')


class CoverageTests(unittest.TestCase):
    def test_source_zone_prevents_false_nearby_association(self):
        rows = [{'sourceTime':'UTC-looking'}, {'sourceTime':'Central-looking'}]
        clocks = [dt.datetime(2025,1,1,h,tzinfo=dt.timezone.utc).timestamp() for h in (12,18)]
        self.assertEqual(audit.nearby('2025-01-01_12_00_00', clocks, rows, 'America/Chicago'),[rows[1]])
        self.assertEqual(audit.nearby('2025-01-01_12_00_00', clocks, rows, 'UTC'),[rows[0]])

    def test_fall_back_keeps_both_candidates(self):
        clocks = audit.candidates('2024-11-03_01_30_00', 'America/Chicago')
        self.assertEqual(len(clocks),2)
        self.assertEqual(clocks[1]-clocks[0],3600)

    def test_spring_gap_cannot_be_associated(self):
        self.assertEqual(audit.candidates('2024-03-10_02_30_00','America/Chicago'),[])

    def test_intervals_measure_only_distinct_observations(self):
        t = dt.datetime(2024,1,1,tzinfo=dt.timezone.utc)
        result = audit.gaps([t,t,t+dt.timedelta(hours=1),t+dt.timedelta(days=2)])
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]['secondsBetweenObservations'],47*3600)

    def test_empty_event_array_is_empty_data(self):
        self.assertEqual(verify.page_events('var events=[];\n'),[])

    def test_rejected_or_blank_page_is_not_empty_events(self):
        for page in ('','Request Rejected','<html>Error</html>'):
            with self.assertRaises(ValueError): verify.page_events(page)

    def test_page_events_are_parsed_as_data(self):
        text='var events=[];\nevents[0]=["056","date", "date", "status", "", "123"];\n'
        self.assertEqual(verify.page_events(text),[['events[0]=[056','date',' date',' status',' ',' 123];']])
        with self.assertRaises(ValueError): verify.page_events('var events=[];\nevents[0]=alert("x");')

    def test_duplicate_event_indexes_rejected(self):
        row='events[0]=["a","b","c","d","e","f"];'
        with self.assertRaises(ValueError): verify.page_events('var events=[];\n'+row+'\n'+row)


if __name__=='__main__':
    unittest.main()
