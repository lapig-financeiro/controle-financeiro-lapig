import '@fontsource-variable/inter';
import './estilo/tokens.css';
import './estilo/base.css';

import { render } from 'preact';
import { App } from './App.jsx';

render(<App />, document.getElementById('app'));
