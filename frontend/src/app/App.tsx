import { ReactFlowProvider } from '@xyflow/react';
import WorkspacePage from '../pages/WorkspacePage';
import { PreferencesProvider } from './Preferences';

export default function App() {
  return <PreferencesProvider><ReactFlowProvider><WorkspacePage /></ReactFlowProvider></PreferencesProvider>;
}
