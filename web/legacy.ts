import './style.css';
if (document.body.dataset.view === 'comparisons') void import('./comparisons');
else void import('./legacy-archive');
