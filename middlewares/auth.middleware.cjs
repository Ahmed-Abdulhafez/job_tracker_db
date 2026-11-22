const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
    // محاولة قراءة التوكن إما من الكوكيز أو من الـ Headers
    const token = req.cookies?.token || (req.headers['authorization'] && req.headers['authorization'].split(' ')[1]);

    if (!token) {
        return res.status(401).json({ error: "لا يوجد توكن، غير مسموح بالوصول" });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ error: "التوكن غير صالح أو انتهت صلاحيته" });
        }
        
        // ربط بيانات المستخدم (اللي جواها الـ id) بـ req.user
        req.user = decoded; 
        next();
    });
};

module.exports = verifyToken;