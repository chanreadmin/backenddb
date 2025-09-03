// /routes/index.js
import express from 'express';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import diseaseRoutes from './diseaseRoutes.js';


const router = express.Router();

// Mount the routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/disease', diseaseRoutes)




export default router;