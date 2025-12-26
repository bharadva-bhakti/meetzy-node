module.exports = (sequelize, DataTypes) => {
    const Plan = sequelize.define(
        'Plan',
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true
            },
            name: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            slug: {
                type: DataTypes.STRING,
                allowNull: false,
                unique: true,
                validate: {
                    is: /^[a-z0-9-]+$/
                }
            },
            description: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            // Pricing Information
            price_per_user_per_month: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: false,
                defaultValue: 0.00,
                validate: {
                    min: 0
                }
            },
            price_per_user_per_year: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: true,
                defaultValue: null,
                validate: {
                    min: 0
                }
            },
            billing_cycle: {
                type: DataTypes.ENUM('monthly', 'yearly', 'both'),
                defaultValue: 'monthly',
            },
            stripe_price_id: {
                type: DataTypes.STRING,
                allowNull: true,
            },

            // plans features
            max_members_per_group: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 10,
                validate: { min: 1 }
            },
            max_broadcasts_list: {
              type: DataTypes.INTEGER,
              allowNull: false,
              defaultValue: 10,
            },
            max_members_per_broadcasts_list: {
              type: DataTypes.INTEGER,
              allowNull: false,
              defaultValue: 10,
              validate: { min: 1 },
            },
            max_status: {
              type: DataTypes.INTEGER,
              allowNull: false,
              defaultValue: 10,
            },
            max_storage_per_user_mb: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 5000,
            },

            // per user maximum groups creation
            max_groups: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 50,
            },
            allows_file_sharing: {
                type: DataTypes.BOOLEAN,
                defaultValue: true,
            },
            features: {
                type: DataTypes.JSON,
                defaultValue: {},
                comment: 'Flexible key-value store for additional features'
            },
            // Metadata
            display_order: {
                type: DataTypes.INTEGER,
                defaultValue: 0,
                comment: 'For sorting plans in UI'
            },
            is_default: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
                comment: 'Default plan for new teams'
            },
            trial_period_days: {
                type: DataTypes.INTEGER,
                defaultValue: 0,
                validate: {
                    min: 0
                }
            },
            status: {
                type: DataTypes.ENUM('active', 'inactive'),
                defaultValue: 'active',
            }
        },
        {
            tableName: 'plans',
            timestamps: true,
            paranoid: true,
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            deletedAt: 'deleted_at',
            indexes: [
                { unique: true, fields: ['slug']},
                { fields: ['status', 'display_order']}
            ]
        }
    );

    Plan.prototype.isFreePlan = function () {
        return this.price_per_user_per_month === 0;
    };

    Plan.prototype.hasTrial = function () {
        return this.trial_period_days > 0;
    };

    Plan.prototype.getYearlyPrice = function () {
        if (this.price_per_user_per_year) {
            return this.price_per_user_per_year;
        }
        return Number((this.price_per_user_per_month * 12 * 0.8).toFixed(2));
    };

    return Plan;
};