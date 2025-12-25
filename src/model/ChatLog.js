const { DataTypes } = require('sequelize');
const sequelize = require('../config/database'); // Make sure this points to your Postgres connection file

const ChatLog = sequelize.define('ChatLog', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'user_id' // Maps to 'user_id' column in DB
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  sender: {
    type: DataTypes.ENUM('user', 'bot'),
    allowNull: false
  },
  isAi: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'is_ai'
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  }
}, {
  tableName: 'chat_logs', // Matches the SQL table name
  timestamps: false // We are handling created_at manually, or set to true if you want 'updatedAt' too
});

module.exports = ChatLog;