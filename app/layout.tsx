import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PID Control Simulator — Real-Time Robot Dynamics & Auto-Tuning',
  description:
    'Enterprise-grade PID control simulation with 11 robotic plant models, real-time oscilloscope, 2D physics animation, and dual-engine auto-tuning (Ziegler-Nichols, Cohen-Coon, ITAE, Nelder-Mead numerical optimization).',
  keywords: [
    'PID controller',
    'control systems',
    'robotics simulation',
    'auto-tuning',
    'Ziegler-Nichols',
    'step response',
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
