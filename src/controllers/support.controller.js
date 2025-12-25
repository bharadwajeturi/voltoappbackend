const faqData = require('../data/faqDetails.json'); // 🟢 Ensure JSON file is here

exports.getFAQs = (req, res) => {
    try {
        const { category, search } = req.query;
        let results = faqData;

        // 1. Filter by Category
        if (category && category !== 'All') {
            results = results.filter(q => q.category === category);
        }

        // 2. Filter by Search
        if (search) {
            const term = search.toLowerCase();
            results = results.filter(q => 
                q.question.toLowerCase().includes(term) || 
                (q.keywords && q.keywords.some(k => k.includes(term)))
            );
        }

        res.json({ success: true, count: results.length, data: results });
    } catch (error) {
        console.error("FAQ Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch FAQs" });
    }
};