import "./App.css";
import TransactionGrid from "./TransactionGrid";
import AppearanceProvider from "./AppearanceProvider";

function App() {
  return (
    <AppearanceProvider>
      <main className="container">
        <TransactionGrid />
      </main>
    </AppearanceProvider>
  );
}

export default App;
