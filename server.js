const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const axios = require('axios');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');

require('dotenv').config();

const app = express();

// EJS as the view engine
app.set('view engine', 'ejs');

// Session middleware
app.use(session({
    secret: 'web123',
    resave: false,
    saveUninitialized: true
}));

// Middleware for parsing request body
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(express.static('public'));

// Email configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.USER,
        pass: process.env.PASS
    }
});

// Email sending function
async function sendEMail(email, message) {
    try {
        const mailOptions = {
            from: process.env.USER,
            to: email,
            subject: 'WEB',
            text: message,
        };

        await transporter.sendMail(mailOptions);
        console.log('Email sent successfully');
    } catch (error) {
        console.log(`Error occured: ${error}`);
    }
}

// Connect to MongoDB
mongoose.connect(process.env.MONGODB);
const db = mongoose.connection;

// User schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    firstName: { type: String },
    lastName: { type: String },
    age: { type: Number },
    country: { type: String },
    gender: { type: String },
    role: { type: String, default: 'regular' },
    createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

// User model
const User = mongoose.model('User', userSchema);

app.get('/', async (req, res) => {
    const username = req.session.username || null;
    res.render('index', { username });
});

// Registration Page
app.get('/register', (req, res) => {
  res.render('register');
});

// Handle user registration
app.post('/register', async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const user = new User({
      username: req.body.username,
      password: hashedPassword,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      age: req.body.age,
      country: req.body.country,
      gender: req.body.gender
    });
    await user.save();
    await sendEMail(process.env.OTHER, 'Welcome to our platform!\nThank you for choosing our platform.');
    res.redirect('/login');
  } catch {
    res.redirect('/register');
  }
});

// Login Page
app.get('/login', (req, res) => {
  res.render('login');
});

// Handle user login
app.post('/login', async (req, res) => {
  const user = await User.findOne({ username: req.body.username });
  if (user == null) {
    return res.redirect('/login');
  }
  try {
    if (await bcrypt.compare(req.body.password, user.password)) {
        await sendEMail(process.env.OTHER, 'You have logged into our platform!');
        const username = user.username;

        const items = await Item.find();
        req.session.username = username;
        req.session.role = user.role;
        res.render('index', { username, items });
    } else {
      res.redirect('/login');
    }
  } catch {
    res.redirect('/login');
  }
});

// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
        } else {
            res.redirect('/');
        }
    });
});

app.get('/admin', async (req, res) => {
    if (req.session && req.session.role === 'admin') {
        try {
            const username = req.session.username;
            const items = await Item.find({ deletedAt: { $exists: false } });
            res.render('admin', { username, items });
        } catch (error) {
            console.error(error);
            res.status(500).send('Internal Server Error');
        }
    } else {
        res.redirect('/');
    }
});


app.get('/about', (req, res) => {
    const username = req.session.username;
    res.render('about', { username });
})

app.get('/contact', (req, res) => {
    const username = req.session.username;
    res.render('contact', { username });
})

app.get('/items', async (req, res) => {
    const items = await Item.find({ deletedAt: { $exists: false } });
    const username = req.session.username;
    res.render('items', { username, items });
})

const itemSchema = new mongoose.Schema({
    pictures: [String],
    name: {
        en: String,
        localized: String
    },
    description: {
        en: String,
        localized: String
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    deletedAt: { type: Date }
});

const Item = mongoose.model('Item', itemSchema);

// Add Item
app.post('/admin/addItem', async (req, res) => {
    try {
        const { pictures, name_en, name_localized, description_en, description_localized } = req.body;
        const newItem = new Item({
            pictures: pictures.split(','),
            name: { en: name_en, localized: name_localized },
            description: { en: description_en, localized: description_localized }
        });
        await newItem.save();
        res.redirect('/admin');
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

// Edit Item
app.post('/admin/updateItem/:id', async (req, res) => {
    try {
        const itemId = req.body.id;
        const { edit_pictures, edit_name_en, edit_name_localized, edit_description_en, edit_description_localized } = req.body;
        const updatedItem = {
            pictures: edit_pictures.split(','),
            name: { en: edit_name_en, localized: edit_name_localized },
            description: { en: edit_description_en, localized: edit_description_localized },
            updatedAt: Date.now()
        };
        await Item.findByIdAndUpdate(itemId, updatedItem);
        res.redirect('/admin');
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

// Delete Item
app.post('/admin/deleteItem/:id', async (req, res) => {
    try {
        const itemId = req.params.id;
        await Item.findByIdAndUpdate(itemId, { deletedAt: Date.now() });
        res.redirect('/admin');
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

// Route to fetch data from Alpha Vantage API
app.get('/stocks', async (req, res) => {
    try {
        const response = await axios.get(`https://www.alphavantage.co/query?function=TIME_SERIES_MONTHLY&symbol=IBM&apikey=${process.env.apikey}`);
        const chartData = response.data;
    
        const username = req.session.username;
        res.render('chart', { username, chartData });
    } catch (error) {
        console.error('Error fetching stock data:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/earnings', async (req, res) => {
    try {
        // Fetching data from Alpha Vantage API for IBM earnings
        const response = await axios.get(`https://www.alphavantage.co/query?function=EARNINGS&symbol=IBM&apikey=${process.env.apikey}`);
        const data = response.data;

        const username = req.session.username;
        res.render('ibm', { username, data });
    } catch (error) {
        console.error('Error fetching earnings data:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/nasa', async (req, res) => {
    try {
        const response = await axios.get(`https://api.nasa.gov/planetary/apod?api_key=${process.env.nasaapi}`);

        const data = response.data;
        const date = data.date;
        const image = data.url;

        const username = req.session.username;
        
        res.render('nasachart', { username, date, image });
    } catch (error) {
        console.error('Error fetching data from NASA API:', error);
        res.status(500).send('Internal Server Error');
    }
});


// Start server
const PORT = 3000
app.listen(PORT, () => {
  console.log(`App is running on http://localhost:${PORT}`);
});































// stocks
// const monthlyData = response.data['Monthly Time Series'];
// const labels = Object.keys(monthlyData).reverse().slice(0, 5); // Get the latest 5 labels
// const closingPrices = labels.map(date => parseFloat(monthlyData[date]['4. close'])).reverse(); // Get the latest 5 closing prices and reverse to maintain order
        
// const chartData = {
//    labels: labels,
//    closingPrices: closingPrices
// };