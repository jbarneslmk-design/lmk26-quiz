// Small quiz for local testing only (dev/serve_test_site.sh copies it in as js/questions.js).
window.QUIZ = { title: "LMK 26", subtitle: "Local test", defaultDuration: 20,
  drawing: { mode: "both", placement: "after", guessDuration: 15, maxQuestions: 2 },
  drawPrompts: ["The printer jamming at 4:59 on a Friday | The photocopier eating the contract | The printer out of toner on payroll day | Fixing the printer with a hammer",
    "Lunch stolen from the fridge | A passive-aggressive note on the fridge | Someone eating your yoghurt | Labelling every item in the fridge",
    "The kettle queue at 10am | The kettle that takes forever to boil | Making a brew round for 15 people | Someone using your favourite mug",
    "The forklift doing a 12-point turn | A forklift lifting the wrong pallet | Racing pallet trucks | A forklift covered in fairy lights",
    "Reply all disaster", "Monday morning before coffee"],
  prizes: [{ name: "Luxury hamper", from: "Smiths Foods" }, { name: "Bottle of fizz" }, { name: "Box of chocolates" }],
  questions: [
    { round: "Round 1", type: "choice", text: "Which was our busiest month?", options: ["January", "March", "July", "November"], answer: 3, funFact: "November: 4,312 orders." },
    { round: "Round 1", type: "number", text: "How many orders did we ship in 2026?", answer: 18450, unit: "orders" },
    { type: "draw", duration: 25 },
    { round: "Round 2", type: "choice", text: "Who makes the best brew?", options: ["Dave", "Sharon", "Kev", "Priya"], answer: 1 },
    { round: "Final", type: "choice", text: "Longest-serving customer?", options: ["Smiths", "Jones Ltd", "Acme", "Bloggs"], answer: 0, double: true }
  ] };
