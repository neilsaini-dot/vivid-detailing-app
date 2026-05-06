import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";

import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import BookingFlow from "@/pages/booking";
import TintVisualizer from "@/pages/tint-visualizer";
import Dashboard from "@/pages/dashboard";
import AdminPanel from "@/pages/admin";
import QuoteRequest from "@/pages/quote";
import ReviewPage from "@/pages/review";

const queryClient = new QueryClient();

function Router() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <Switch>
          <Route path="/">{() => { window.location.replace((import.meta.env.BASE_URL + "book").replace(/\/\//g, "/")); return null; }}</Route>
          <Route path="/book" component={BookingFlow} />
          <Route path="/tint-visualizer" component={TintVisualizer} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/admin" component={AdminPanel} />
          <Route path="/quote" component={QuoteRequest} />
          <Route path="/review" component={ReviewPage} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <Footer />
    </div>
  );
}

function App() {
  // Enforce dark mode
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
