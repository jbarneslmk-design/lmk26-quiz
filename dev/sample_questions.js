// Small quiz for local testing only (dev/serve_test_site.sh copies it in as js/questions.js).
window.QUIZ = { title: "LMK 26", subtitle: "Local test", defaultDuration: 20,
  drawing: { mode: "both", placement: "after", guessDuration: 15, maxQuestions: 2 },
  drawPrompts: ["The printer jamming at 4:59 on a Friday", "Reply all disaster", "The last biscuit in the tin", "Monday morning before coffee", "Lunch stolen from the fridge", "The kettle queue"],
  prizes: [{ name: "Luxury hamper", from: "Smiths Foods" }, { name: "Bottle of fizz" }, { name: "Box of chocolates" }],
  questions: [
    { round: "Round 1", type: "choice", text: "Which was our busiest month?", options: ["January", "March", "July", "November"], answer: 3, funFact: "November: 4,312 orders." },
    { round: "Round 1", type: "number", text: "How many orders did we ship in 2026?", answer: 18450, unit: "orders" },
    { type: "draw", duration: 25 },
    { round: "Round 2", type: "choice", text: "Who makes the best brew?", options: ["Dave", "Sharon", "Kev", "Priya"], answer: 1 },
    { round: "Final", type: "choice", text: "Longest-serving customer?", options: ["Smiths", "Jones Ltd", "Acme", "Bloggs"], answer: 0, double: true }
  ] };
