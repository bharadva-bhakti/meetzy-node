const Sequelize = require('sequelize');
const process = require('process');
const env = process.env.NODE_ENV || 'development';
const config = require(__dirname + '/../config/config.js')[env];
const db = {};

let sequelize;
if (config.use_env_variable) {
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, config);
}

const { DataTypes } = Sequelize;

db.User = require('./user.model')(sequelize, DataTypes);
db.OTPLog = require('./otp-log.model')(sequelize, DataTypes);
db.Session = require('./session.model')(sequelize, DataTypes);
db.Message = require('./message.model')(sequelize, DataTypes);
db.MessageStatus = require('./message-status.model')(sequelize, DataTypes);
db.Group = require('./group.model')(sequelize, DataTypes);
db.GroupMember = require('./group-member.model')(sequelize, DataTypes);
db.GroupSetting = require('./group-setting.model')(sequelize, DataTypes);
db.UserDelete = require('./user-delete.model')(sequelize, DataTypes);
db.Friend = require('./friend.model')(sequelize, DataTypes);
db.Notification = require('./notification.model')(sequelize, DataTypes);
db.Block = require('./block.model')(sequelize, DataTypes);
db.Archive = require('./archive.model')(sequelize, DataTypes);
db.PinnedConversation = require('./pinned-conversation.model')(sequelize, DataTypes);
db.MessageReaction = require('./message-reaction.model')(sequelize, DataTypes);
db.Favorite = require('./favorite.model')(sequelize, DataTypes);
db.Setting = require('./setting.model')(sequelize, DataTypes);
db.MessageAction = require('./message-action')(sequelize, DataTypes);
db.MutedChat = require('./muted-chat.model')(sequelize, DataTypes);
db.Faq = require('./faq.model')(sequelize, DataTypes);
db.Wallpaper = require('./wallpaper.model')(sequelize, DataTypes);
db.Sticker = require('./sticker.model')(sequelize, DataTypes);
db.Page = require('./page.model')(sequelize, DataTypes);
db.ContactInquiry = require('./contact-inquiries.model')(sequelize, DataTypes);
db.ReportReason = require('./report-reason.model')(sequelize, DataTypes);
db.UserReport = require('./user-report.model')(sequelize, DataTypes);
db.UserSetting = require('./user-setting.model')(sequelize, DataTypes);
db.ChatClear = require('./chat_clear.model')(sequelize, DataTypes);
db.GoogleToken = require('./google-token.model')(sequelize, DataTypes);
db.Status = require('./status.model')(sequelize, DataTypes);
db.StatusView = require('./status-view.model')(sequelize, DataTypes);
db.Call = require('./call.model')(sequelize, DataTypes);
db.CallParticipant = require('./call-participant.model')(sequelize, DataTypes);
db.SMSGateway = require('./custom-sms.model')(sequelize, DataTypes);
db.Gateway = require('./sms_gateways')(sequelize, DataTypes);
db.MutedStatus = require('./muted-status.model')(sequelize, DataTypes);
db.MessagePin = require('./message-pin.model')(sequelize, DataTypes);
db.ChatSetting = require('./chat-setting.model')(sequelize, DataTypes);
db.MessageDisappearing = require('./message-disappearing.model')(sequelize, DataTypes);
db.VerificationRequest = require('./verification-request.model')(sequelize, DataTypes);
db.Plan = require('./plan.model')(sequelize, DataTypes);
db.Subscription = require('./subscription.model')(sequelize, DataTypes);
db.Payment = require('./payment.model')(sequelize, DataTypes);
db.Announcement = require('./announcement.model')(sequelize, DataTypes);
db.Broadcast = require('./broadcast.model')(sequelize, DataTypes);
db.BroadcastMember = require('./broadcast-member.model')(sequelize, DataTypes);
db.Language = require('./language.model')(sequelize, DataTypes);

Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
