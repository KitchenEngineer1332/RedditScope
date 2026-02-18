# RedditScope
RedditScope is a deep Reddit profile intelligence platform that analyzes any public Reddit user and generates behavioral analytics, engagement metrics, activity patterns, and a personality archetype. The application is built entirely with vanilla JavaScript, HTML, and CSS. No backend and no external libraries are required.

# Overview
RedditScope fetches public Reddit user data and performs client-side analysis to generate structured insights. The system includes a custom analytics engine, sentiment scoring, persona detection logic, and multiple canvas-based visualizations.

The entire application runs in the browser.

*Note: You need to make your id public to make this thing work.*

# Core Features
**Profile Intelligence**

* Fetches public Reddit profile metadata
* Account age calculation
* Karma Breakdown (Post and Comment Karma)
* Badge detection (Premium, verified, Employee)
* Avatar fallback Handling

**Analytics Engine**

* Up to 200 comments analyzed
* Average post score
* Posts per month
* Comment-to-post ratio
* Engagement metrics
* Award totals
* Controversiality score
* Sentiment scoring using a lexicon-based model
* Word frequency extraction

**Persona Detection**

The persona engine classifies users into deterministic behavioral archetypes based on:

* Average score
* Activity distribution (hour-of-day and weekday)
* Comment-to-post ratio
* Sentiment score
* Subreddit concentration
* Posting frequency

Examples of persona categories include:

* Reddit Legend
* Viral Creator
* Comment Dynamo
* Pure Creator
* Night Owl
* Early Bird
* Positivity Beacon
* Edgelord
* Community Hopper
* Explorer (default)

# Visualizations

All visualizations are built manually using the Canvas API. No charting libraries are used.

* Karma donut chart
* Content type donut chart
* Hour-of-day activity bar chart
* Weekly activity heatmap
* Animated stats ticker
* Word frequency data
* Animated metric counters

# UI and Design System

The interface uses a dark luxury aesthetic with glassmorphism layering and animated background effects.

**Key characteristics:**

* CSS variable-based theme system
* Light and dark mode toggle
* Responsive grid layout
* Smooth micro-interactions
* Animated starfield canvas background
* Animated gradient orbs
