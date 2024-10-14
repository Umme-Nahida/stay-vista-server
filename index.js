const express = require('express')
const app = express()
require('dotenv').config()
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId, Timestamp } = require('mongodb')
const jwt = require('jsonwebtoken')
const morgan = require('morgan')
const port = process.env.PORT || 8000
const stripe = require('stripe')(process.env.SRIPE_SECRET_KEY)

// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))
app.use(express.json())
app.use(cookieParser())
app.use(morgan('dev'))


const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token
  console.log(token)
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log('err',err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}

// console.log(process.env.DB_User)

const uri = `mongodb+srv://${process.env.DB_User}:${process.env.DB_Pass}@cluster0.ytj0kf8.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {
  try {
    const bookingDB = client.db('stay-vista')
    const roomsCollection = bookingDB.collection('roomsCollection')
    const usersCollection = bookingDB.collection('usersCollection') 
    const bookingCollection = bookingDB.collection('bookingsCollection') 

    // verify admin role api 
    const verifyAdmin = async(req,res,next)=>{
     const email = req.user;
     const query = {email:email}
     const user = await usersCollection.findOne(query)
     if(!user || !user.role === 'admin') return res.status(401).send({message:'UnAuthrized access (no admin)'})
      next()
    }

    // auth related api
    app.post('/jwt', async (req, res) => {
      const user = req.body
      console.log('I need a new jwt', user)
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })

    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
        console.log('Logout successful')
      } catch (err) {
        res.status(500).send(err)
      }
    }) 

    // Save or modify user email, status in DB
    app.put('/users/:email', async (req, res) => {
      try {
        const email = req.params.email;
        const user = req.body;
        const query = { email: email };
        const options = { upsert: true };
        
        const isExist = await usersCollection.findOne(query);
        console.log('User found?----->', isExist);
        
        if (isExist) {
          if (isExist?.status === 'Requested') {
            const result = await usersCollection.updateOne(query, { $set: user.status }, options);
            return res.send(result);  // Return here to avoid further execution
          } else {
            return res.send({ message: 'User already exists' });  // Return to prevent multiple sends
          }
        }
        
        // If the user doesn't exist, update with a timestamp
        const result = await usersCollection.updateOne(
          query,
          { $set: { ...user, timestamp: Date.now() } },
          options
        );
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Server error' });  // Handle any server errors
      }
    });



    // create api for become a any role position by admin 
    app.put('/userHost/:email',verifyToken,verifyAdmin, async (req, res) => {
      try {
        const email = req.params.email;
        const user = req.body;
        const query = { email: email };
        const options = { upsert: true };
        console.log('host',user)
        
        //  update guest role for become a host  
        const result = await usersCollection.updateOne(
          query,
          { $set: {role: user.role, status:'Verified'}},
          options
        );
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Server error' });  // Handle any server errors
      }
    });
    

    // get all rooms data
    app.get('/rooms',async(req,res)=>{
      const rooms = await roomsCollection.find().toArray()
      res.send(rooms)
    })

    // get one room data by using id 
    app.get('/rooms/:id', verifyToken,async(req,res)=>{
      const id = req.params.id;
      console.log(id)
      const query = {_id: new ObjectId(id)}
      const rooms = await roomsCollection.findOne(query)
      res.send(rooms)
    })

    // get host room 
    try{
       app.get('/hostRooms/:email',verifyToken,async(req,res)=>{
         const email = req.params.email;
         console.log(email)
         const query = {'host.email': email}
         const result = await roomsCollection.find(query).toArray()
         res.send(result)
       })
    }catch(err){
      console.log(err)
    }

    // save room data 
    try{
      app.post('/saveRooms',verifyToken,async(req,res)=>{
        const room = req.body
        const result = await roomsCollection.insertOne(room)
        res.send(result)
      }
      )
    }catch(err){
      console.log(err)
    }


    // get user role 
    try{
     app.get('/getUserRole/:email',verifyToken, async(req,res)=>{
      const email = req.params.email;
      const query = {email: email}
      const result = await usersCollection.findOne(query)
      res.send(result)
     })
    }catch(err){
      console.log(err)
    }


    // create payment intent 
    try{
      app.post('/paymentIntent',async(req,res)=>{
        const {price} = req.body;
        console.log("price:",price)

        // create payment intent 
        const paymentIntent = await stripe.paymentIntents.create({
          amount:parseFloat(price * 100),
          currency: "usd",
          payment_method_types:['card']
        })

        res.send({clientSecret: paymentIntent.client_secret})
      })
    }catch(err){
      console.log(err)
    }

    // save bookings data 
    try{
     app.post('/bookings',async(req,res)=>{
      const bookings = req.body;
      const result = await bookingCollection.insertOne(bookings);
      res.send(result)
     })
    }catch(err){
      console.log(err)
    }

    // update bookings status 
    try{
     app.patch('/updatedStatus/:id',async(req,res)=>{
      const id = req.params.id;
      const status = req.body.status;
      const query = {_id: new ObjectId(id)}
      const updateData = {
        $set: {
          booked: status
        }
      }

      const result = await roomsCollection.updateOne(query,updateData)
      res.send(result)
     })
    }catch(err){
      console.log(err)
    }


    // get all booking for guest
    try{
     app.get('/bookings',async(req,res)=>{
      const email = req.query.email;
      if(!email) return res.send({massage:"not found any guest email"})
      const query = {'guest.email': email}
      const result = await bookingCollection.find(query).toArray()
      res.send(result)
     })
    }catch(err){
      console.log(err)
    }
    // get all booking for host
    try{
     app.get('/bookings/host',async(req,res)=>{
      const email = req.query.email;
      if(!email) return res.send({massage:"not found any guest email"})
      const query = {host: email}
      const result = await bookingCollection.find(query).toArray()
      res.send(result)
     })
    }catch(err){
      console.log(err)
    }

    // get all user from db 
    try{
         app.get('/users',async(req,res)=>{
          const result = await usersCollection.find().toArray();
          res.send(result)
         })
    }catch(err){
      console.log(err)
    }

    try{
       app.put('/updateUser/:email',async(req,res)=>{
        const email = req.params.email;
        const user = req.body;
        const query={email:email}
        const option = {upsert: true}
        const updateRole = {
          $set: {
            ...user,
            timestamp: Date.now()
          }
        }
        const result = await usersCollection.updateOne(query,updateRole,option)
        res.send(result)

       })
    }catch(err){
      console.log(err)
    }

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from StayVista Server..')
})

app.listen(port, () => {
  console.log(`StayVista is running on port ${port}`)
})
