function addVirtualId(schema) {
  schema.virtual('id').get(function () {
    return this._id.toHexString();
  });

  schema.set('toJSON', {
    virtuals: true,
    transform: (doc, ret) => {
      delete ret._id;
      return ret;
    }
  });

  schema.set('toObject', {
    virtuals: true,
    transform: (doc, ret) => {
      delete ret._id;
      return ret;
    }
  });
}
  
module.exports = { addVirtualId };