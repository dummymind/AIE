const express = require("express")
const session = require("express-session")
const bodyParser = require('body-parser')
const cookieParser = require("cookie-parser")
const helmet = require("helmet")
require('dotenv').config();
const jwt = require('jsonwebtoken');
const msal = require('@azure/msal-node')
const axios = require("axios")
var AzureTablesStoreFactory = require('connect-azuretables')(session)

const accounts = require("./models/accounts")
const activities = require("./models/activity_table_v")
const tivi_activity = require("./models/tivi_activity")
const account_v = require("./models/account_v")
const ideas = require("./models/ideas")
const Sequelize = require("sequelize")
const restRouter = require("./routes/rest_api")
const questions = require("./models/innovation_question")

const app = express();

const config = {
	auth: {
		clientId: process.env.CLIENT,
		authority: 'https://login.microsoftonline.com/capgemini.com/',
		clientSecret: process.env.SECRET,
	},
	system: {
		loggerOptions: {
			loggerCallback(loglevel, message, containsPii) {
				console.log(message)
			},
			piiLoggingEnabled: false,
			logLevel: msal.LogLevel.Verbose,
		},
	},
}

const cca = new msal.ConfidentialClientApplication(config)

//HTTP Request header security
app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://stackpath.bootstrapcdn.com",
            "https://cdn.jsdelivr.net",
            "https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js",
            "https://sqlchatbotic-d5evcpdtfabrewg7.eastus-01.azurewebsites.net"
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://stackpath.bootstrapcdn.com",
            "https://cdn.jsdelivr.net",
            "https://cdnjs.cloudflare.com",
            "https://fonts.googleapis.com"
          ],
          imgSrc: ["'self'", "https://source.unsplash.com", "https://logo.clearbit.com", "data:", "https://sqlchatbotic-d5evcpdtfabrewg7.eastus-01.azurewebsites.net"],
          connectSrc: ["'self'", "blob:", "https://sqlchatbotic-d5evcpdtfabrewg7.eastus-01.azurewebsites.net"],
          fontSrc: ["'self'", "https://stackpath.bootstrapcdn.com", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
    })
  );

let isSecure = process.env.ENV == "PROD";
console.log("## isSecure :: ", isSecure)

let sessOpts = {
  sessionTimeOut: 70,
  AZURE_STORAGE_CONNECTION_STRING: process.env.AZURE_STORAGE_CONNECTION_STRING,
  table: 'ailm',
}

let sessionOpts = {
  store: AzureTablesStoreFactory.create(sessOpts),
  secret:"This is the new rag tool for better ailm",
  resave:false,
  saveUninitialized:true,
  cookie:{secure:false}
}
app.use(session(sessionOpts))
console.log(JSON.stringify(sessionOpts))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({extended:true}))
app.use(cookieParser())

app.engine('html', require("squirrelly").renderFile);
app.set("view engine", "html")

async function validateUser(req, res, next) {
  let user = req.session.user
  // console.log("## in validate user :: ", JSON.stringify(user))
  if (user === undefined) {
    if (process.env.ENV == 'DEV') {
      user = {}
      user.details = [];
      user.details[0] = {role:"user"}
      user.email = 'test@capgemini.com'
      user.name = 'test_user'
      req.session.user = user

      next()
    } else {
      req.session.redirect = req.originalUrl
      res.redirect('/login')
      return false
    }
  } else {
    next()
  }
}

app.use((err, req, res, next) => {
    if (err instanceof Sequelize.ValidationError) {
      return res.status(400).json({
        errors: err.errors.map(e => ({
          field: e.path,
          message: e.message,
        })),
      });
    }
  
    if (err instanceof Sequelize.DatabaseError) {
      return res.status(500).json({
        error: 'A database error occurred',
        details: err.message,
      });
    }
  
    return res.status(500).json({
      error: 'An unknown error occurred',
      details: err.message,
    });
  });

app.use("/public", validateUser, express.static("public"))
app.use("/rest", validateUser, restRouter)


app.get('/login', (req, res) => {
	const protocol = req.protocol
	const host = req.get('host')

	const authCodeUrlParameters = {
		scopes: ['user.read', 'profile'],
		redirectUri: process.env.REDIRECT_URI,
	}
	cca
		.getAuthCodeUrl(authCodeUrlParameters)
		.then((response) => {
			res.redirect(response)
		})
		.catch((error) => console.log(JSON.stringify(error)))
})

app.get('/redirect', (req, res) => {
	const tokenRequest = {
		code: req.query.code,
		scopes: ['user.read', 'profile'],
		redirectUri: process.env.REDIRECT_URI,
	}
	cca
		.acquireTokenByCode(tokenRequest)
		.then(async (response) => {
			let user = {}
			user.email = response.account.username
			user.name = response.account.name
			user.token = response.accessToken
			user.designation = await getUserProfile(
				user.token,
				response.account.username
			)
			req.session.user = user

			console.log(user)
			req.session.save()
			if (req.session.redirect) {
				let redirect = req.session.redirect
				req.session.redirect = undefined
				res.redirect(redirect)
			} else {
				res.redirect('/')
			}
		})
		.catch((error) => {
			res.status(500).send(error)
		})
})

async function getUserProfile(accessToken, email) {
	const options = {
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
	}
	try {
		const response = await axios.get(
			`https://graph.microsoft.com/v1.0/users/${email}`,
			options
		)
		return response.data.jobTitle
	} catch (error) {
		console.log(error)
		return error
	}
}

app.get("/", validateUser, async (req, res, next) => {
    let act = await account_v.findAll();
    res.render("home.html", {accounts:act})
})


// app.get("/", validateUser, async (req, res, next) => {
//   const page = parseInt(req.query.page) || 1;
//   const limit = parseInt(req.query.limit) || 6;
//   const offset = (page - 1) * limit;

//   let act = await account_v.findAll({ offset: offset, limit: limit });
//   let totalCount = await account_v.count();

//   res.render("home.html", {
//       accounts: act,
//       currentPage: page,
//       totalPages: Math.ceil(totalCount / limit),
//   });
// });

app.get("/dashboard", validateUser, (req,res,next) => {
  res.render("dashboard.html");
})

app.get("/superuser", validateUser, (req,res,next) => {
  res.render("super_user1.html");
})

app.get("/add_client", validateUser, (req,res,next) => {
  res.render("add_Client.html");
})

app.get("/acct_details/:client_id", validateUser, async (req, res, next) => {
    try{
        let act = await activities.findAll({where: {client_id: `${req.params.client_id}`}})
        let accName = await accounts.findAll({where: {account_id: `${req.params.client_id}`}})
        let acctIdeas = await ideas.findAll({where: {account_id: `${req.params.client_id}`}})
        req.session["account_id"] = req.params.client_id;
        let tivi_activities = await tivi_activity.findAll();
       
        res.render("acct_landing.html", {accounts: accName, activities:act, tivi:tivi_activities, ideas:acctIdeas})
        console.log("## session set :: ", req.session.account_id)
    }catch(e){
      console.error(e);
        res.redirect("/");
    }    
})



// New Page Innovation Assesment Page 
app.get("/acct_details/assesment/:client_id", validateUser, async (req, res, next) => {
  try{
      let accName = await accounts.findAll({where: {account_id: `${req.params.client_id}`}})
      let ic_questions = await questions.findAll({where: {client_id: `${req.params.client_id}`, valid_till : '3712-12-31' }})
      req.session["account_id"] = req.params.client_id;
      res.render("client_assesment.html", {accounts: accName, client_id: req.params.client_id, ic_questions:ic_questions})
      console.log("## session set :: ", req.session.account_id)
  }catch(e){
    console.error(e);
      res.redirect("/");
  }    
})






module.exports = app